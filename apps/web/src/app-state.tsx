/** Global state: i18n, theme, session, offline status, Dexie outbox and sync triggers (spec 8.1). */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tr, dirFor, type Lang, formatPKR } from '@zt/shared';
import { api } from './api.js';
import { ztdb, deviceId, type OutboxOp, type RefRow } from './cache-db.js';
import { cacheRef, markLocked } from './offline-security.js';
import { bridge, isDesktop, karachiClock, syncStore, useSyncStatus, type SyncStatus } from './desktop.js';
export { ztdb, deviceId } from './cache-db.js';
export type { OutboxOp, RefRow } from './cache-db.js';

export interface Session {
  user: { id: string; name: string; username: string; roles: string[]; permissions: string[] };
  setup_complete: boolean;
}

interface AppState {
  lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string; dir: 'rtl' | 'ltr';
  /** Pick the column that matches the reading language — never a mix of name_ur with an English page. */
  bi: (ur?: string | null, en?: string | null) => string;
  /** Overrides the document title with a page-specific name (product, CMS page). Empty restores the route title. */
  setPageName: (name: string) => void;
  /** The live business name, so the tab title matches the shop rather than the factory default. */
  setBrand: (ur: string, en: string) => void;
  theme: string; setTheme: (t: string) => void;
  online: boolean; session: Session | null; loadingSession: boolean; reloadSession: () => Promise<void>;
  setupStatus: any; reloadSetup: () => Promise<void>;
  pending: number; conflicts: number; syncing: boolean; lastSync: string | null;
  /** The raw Electron queue snapshot — null in a browser, so desktop-only screens can read the
   *  reachability, device id and configuration error the counters alone cannot show. */
  desktopStatus: SyncStatus | null;
  syncNow: () => Promise<{ sent: number; conflicts: number }>;
  enqueue: (type: OutboxOp['type'], payload: Record<string, unknown>) => Promise<OutboxOp>;
  toast: (msg: string, kind?: 'ok' | 'err') => void; toastMsg: { msg: string; kind: string } | null;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
};

/** Which dictionary key names the current route, for the document title. */
const SECTION: [RegExp, string][] = [
  [/^\/(products?)$/, 'products'], [/^\/categories$/, 'categories'], [/^\/category\//, 'categories'],
  [/^\/product\//, 'products'], [/^\/checkout$/, 'checkout'], [/^\/enquiry$/, 'enquiry'],
  [/^\/about$/, 'about'], [/^\/contact$/, 'contact'], [/^\/privacy$/, 'privacy'], [/^\/terms$/, 'terms'],
  [/^\/verify(\/|$)/, 'verifyInvoice'], [/^\/erp/, 'erpArea'],
];
const sectionOf = (path: string) => SECTION.find(([re]) => re.test(path))?.[1] ?? '';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('zt_lang') as Lang) || 'ur');
  const [theme, setThemeState] = useState(() => localStorage.getItem('zt_theme') || 'system');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [setupStatus, setSetupStatus] = useState<any>(null);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; kind: string } | null>(null);
  const timer = useRef<number | null>(null);
  const navigate = useNavigate();
  const desktopStatus = useSyncStatus();

  const t = useCallback((k: string) => tr(k, lang), [lang]);
  const dir = dirFor(lang);
  const bi = useCallback((ur?: string | null, en?: string | null) => (
    lang === 'ur' ? (ur || en || '') : (en || ur || '')
  ), [lang]);
  const setLang = (l: Lang) => { localStorage.setItem('zt_lang', l); setLangState(l); };
  const setTheme = (v: string) => { localStorage.setItem('zt_theme', v); setThemeState(v); };

  const [brand, setBrandState] = useState<{ ur: string; en: string } | null>(null);
  const [pageName, setPageName] = useState('');
  const setBrand = useCallback((ur: string, en: string) => {
    setBrandState((prev) => (prev?.ur === ur && prev?.en === en ? prev : { ur, en }));
  }, []);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToastMsg({ msg, kind });
    window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.documentElement.setAttribute('data-theme', theme);
  }, [lang, dir, theme]);

  // The tab title and share description follow the reading language: an English visit must not be
  // titled in Urdu. Crawlers get the server-rewritten head instead (see worker socialHtml).
  const pathname = useLocation().pathname;
  useEffect(() => {
    const shop = bi(brand?.ur, brand?.en) || tr('appName', lang);
    const section = sectionOf(pathname).length ? t(sectionOf(pathname)) : '';
    const leaf = pageName || section;
    document.title = leaf && leaf !== shop ? `${leaf} — ${shop}` : shop;
    const desc = t('siteTagline');
    const write = (selector: string, value: string, attr = 'content') => {
      const el = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (el) el.setAttribute(attr, value);
    };
    write('meta[name="description"]', desc);
    write('meta[property="og:title"]', document.title);
    write('meta[property="og:description"]', desc);
    write('meta[property="og:locale"]', lang === 'ur' ? 'ur_PK' : 'en_US');
    write('meta[property="og:site_name"]', shop);
    write('meta[name="twitter:title"]', document.title);
    write('meta[name="twitter:description"]', desc);
  }, [lang, dir, pathname, pageName, brand, bi, t]);

  const reloadSession = useCallback(async () => {
    if (isDesktop && bridge) {
      // file:// carries no cookies and no ERP path, so the main process — which holds the Bearer
      // token — is the only thing that can say whether this machine is signed in.
      const s = await bridge.session();
      if (!s.authenticated) { setSession(null); setLoadingSession(false); return; }
      // Still asked through api(): online the bridge forwards it, offline it answers from the cache.
      try { const me = await api<Session>('/api/v1/auth/me'); setSession(me); }
      catch {
        // Offline restart. `/auth/me` is a remote-tier route, so with no network it answers 503 —
        // but the token is still in the vault and the last successful response was cached there.
        // Restoring that session is what makes "later launches work fully offline" true; treating
        // the 503 as a signed-out shop would show the login screen and strand the local mirror.
        const cached = s.user as (Session | null);
        setSession(cached?.user ? { user: cached.user, setup_complete: cached.setup_complete ?? true } : null);
      }
      finally { setLoadingSession(false); }
      return;
    }
    const hasSessionCookie = typeof document !== 'undefined' && /(?:^|;\s*)zt_csrf=/.test(document.cookie);
    const isErpRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/erp');
    if (!hasSessionCookie && !isErpRoute) {
      setSession(null);
      setLoadingSession(false);
      return;
    }
    try { const s = await api<Session>('/api/v1/auth/me'); setSession(s); }
    catch { setSession(null); }
    finally { setLoadingSession(false); }
  }, []);
  const reloadSetup = useCallback(async () => {
    try { setSetupStatus(await api('/api/v1/setup/status')); } catch { /* offline */ }
  }, []);

  const refreshCounts = useCallback(async () => {
    if (isDesktop && bridge) {
      // The main process owns the SQLite outbox; the renderer only mirrors its counters.
      const s = await bridge.status();
      syncStore.publish(s);
      setPending(s.pending);
      setConflicts(s.conflicts);
      setLastSync(karachiClock(s.last_synced_at));
      return;
    }
    setPending(await ztdb.outbox.where('status').anyOf('PENDING', 'FAILED').count());
    setConflicts(await ztdb.outbox.where('status').equals('CONFLICT').count());
  }, []);

  const syncNow = useCallback(async () => {
    if (isDesktop && bridge) {
      if (syncing) return { sent: 0, conflicts: 0 };
      setSyncing(true);
      try {
        const queuedBefore = syncStore.get()?.pending ?? 0;
        const s = await bridge.syncNow();
        syncStore.publish(s);
        return { sent: Math.max(0, queuedBefore - s.pending), conflicts: s.conflicts };
      } finally {
        setSyncing(false);
        await refreshCounts();
        window.dispatchEvent(new Event('zt-synced'));
      }
    }
    if (!navigator.onLine || syncing) return { sent: 0, conflicts: 0 };
    setSyncing(true);
    let sent = 0, conf = 0;
    try {
      const ops = await ztdb.outbox.where('status').anyOf('PENDING', 'FAILED').sortBy('created_at');
      for (const op of ops) {
        try {
          const res = await api<any>('/api/v1/sync/push', {
            method: 'POST',
            body: { idempotency_key: op.id, device_id: op.device_id, type: op.type, payload: op.payload, local_time: op.local_time },
          });
          await ztdb.outbox.update(op.id, { status: res.status === 'CONFLICT' ? 'CONFLICT' : 'SYNCED',
            server_number: res.number, error: res.status === 'CONFLICT' ? res.message_ur : undefined });
          if (res.status === 'CONFLICT') conf++; else sent++;
        } catch (e: any) {
          await ztdb.outbox.update(op.id, { status: 'FAILED', tries: op.tries + 1, error: e.message_ur ?? String(e) });
        }
      }
      setLastSync(new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' }));
    } finally { setSyncing(false); await refreshCounts(); window.dispatchEvent(new Event('zt-synced')); }
    return { sent, conflicts: conf };
  }, [syncing, refreshCounts, toast]);

  const enqueue = useCallback(async (type: OutboxOp['type'], payload: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    const local_time = new Date().toISOString();
    // Desktop identity comes from the main process, which owns the device id for the queue.
    const device_id = isDesktop ? (syncStore.get()?.device_id || deviceId()) : deviceId();
    const op: OutboxOp = { id, device_id, type, payload, local_time,
      status: 'PENDING', tries: 0, created_at: Date.now() };
    if (isDesktop && bridge) {
      // Dexie is deliberately skipped: the main process owns the SQLite outbox and drains it, so a
      // second copy in IndexedDB would be pushed twice. api() carries this write into that queue.
      await api('/api/v1/sync/push', { method: 'POST',
        body: { idempotency_key: op.id, device_id: op.device_id, type, payload, local_time } });
      await refreshCounts();
      toast(lang === 'ur'
        ? 'اندراج اس کمپیوٹر پر محفوظ ہو گیا — آن لائن ہوتے ہی سنک ہوگا'
        : 'Saved on this computer — it syncs as soon as the connection is back');
      return op;
    }
    await ztdb.outbox.add(op);
    await refreshCounts();
    toast('آف لائن اندراج محفوظ ہو گیا — آن لائن ہوتے ہی سنک ہوگا');
    return op;
  }, [refreshCounts, toast, lang]);

  const logout = useCallback(async () => {
    try { await api('/api/v1/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    if (isDesktop) {
      // The api() call above went through the bridge, which drops the stored token. There is no
      // /erp/login file to point location.href at — the hash router owns the route.
      await ztdb.refs.clear(); await ztdb.drafts.clear();
      markLocked();
      setSession(null);
      navigate('/erp/login', { replace: true });
      return;
    }
    await ztdb.refs.clear(); await ztdb.drafts.clear(); await ztdb.outbox.where('status').equals('SYNCED').delete();
    markLocked();
    setSession(null);
    window.location.href = '/erp/login';
  }, [navigate]);

  const can = useCallback((perm: string) => {
    const p = session?.user.permissions ?? [];
    return p.includes('*') || p.includes(perm);
  }, [session]);

  useEffect(() => {
    const dismiss = () => setToastMsg(null);
    window.addEventListener('zt-dismiss-toast', dismiss);
    return () => window.removeEventListener('zt-dismiss-toast', dismiss);
  }, []);

  useEffect(() => {
    reloadSession(); reloadSetup(); refreshCounts();
    // file:// has no scope to serve a worker from, and the desktop app caches in SQLite instead.
    if (!isDesktop && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, [reloadSession, reloadSetup, refreshCounts]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); void syncNow(); };
    const onOffline = () => setOnline(false);
    const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void syncNow(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    const iv = window.setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') void syncNow(); }, 60_000);
    const onFocus = () => { setOnline(navigator.onLine); if (navigator.onLine) void syncNow(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus);
      window.clearInterval(iv);
    };
  }, [syncNow]);

  // Desktop: the main process pushes the state of the queue it owns, so the header chip, the sync
  // screen and every form read one set of numbers instead of a Dexie copy of them.
  useEffect(() => {
    if (!isDesktop || !desktopStatus) return;
    setOnline(desktopStatus.online);
    setPending(desktopStatus.pending);
    setConflicts(desktopStatus.conflicts);
    setSyncing(desktopStatus.syncing);
    setLastSync(karachiClock(desktopStatus.last_synced_at));
  }, [desktopStatus]);

  // Cache role-scoped reference data for offline list screens; wipe on logout.
  useEffect(() => {
    // On desktop this would be a second offline cache beside the main process's SQLite one.
    if (isDesktop) return;
    if (!session || !online) return;
    const paths: [string, string][] = [
      ['products', '/api/v1/products?limit=100'], ['parties', '/api/v1/parties?limit=100'],
      ['accounts', '/api/v1/accounts'], ['categories', '/api/v1/categories'],
    ];
    void (async () => {
      for (const [kind, path] of paths) {
        try {
          const data = await api(path);
          await cacheRef(kind, data);
        } catch { /* permission denied for this role — cache nothing */ }
      }
    })();
  }, [session, online]);

  const value = useMemo<AppState>(() => ({
    lang, setLang, t, dir, bi, setPageName, setBrand, theme, setTheme, online, session, loadingSession, reloadSession,
    setupStatus, reloadSetup, pending, conflicts, syncing, lastSync, desktopStatus, syncNow, enqueue,
    toast, toastMsg, logout, can,
  }), [lang, dir, theme, bi, setBrand, online, session, loadingSession, setupStatus, pending, conflicts, syncing,
    lastSync, desktopStatus, syncNow, enqueue, toast, toastMsg, logout, can, t, reloadSession, reloadSetup]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const fmtMoney = (p: number | null | undefined) => (p === null || p === undefined ? '—' : formatPKR(p));
