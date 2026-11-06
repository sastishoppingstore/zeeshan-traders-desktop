/**
 * Desktop sync centre: the queue and the conflicts the Electron main process keeps in its own
 * SQLite. On web this route is never registered — the ERP keeps the server-backed Sync Centre.
 * Every number and every action here goes through the bridge, because under file:// the renderer
 * has no Dexie queue, no cookies and no direct access to /api/v1/sync/*.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from './app-state.js';
import { Button, DataTable, EmptyState, StatCard, StatusChip, TextField, type Column } from './components.js';
import { bridge, isDesktop, karachiClock, type DesktopConflict, type DesktopOutboxRow } from './desktop.js';

const pretty = (v: unknown) => {
  try { return JSON.stringify(v ?? null, null, 2); } catch { return String(v); }
};

/** Outbox rows arrive with either an epoch or an ISO instant; both are read on the shop's clock. */
const stamp = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  const iso = typeof v === 'number' ? new Date(v).toISOString() : v;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })} ${karachiClock(iso) ?? ''}`.trim();
};

export function DesktopSyncScreen() {
  const { lang, toast, online, pending, conflicts, syncing, lastSync, desktopStatus, syncNow } = useApp();
  const ur = lang === 'ur';
  const nav = useNavigate();
  const [open, setOpen] = useState<DesktopConflict[]>([]);
  const [queue, setQueue] = useState<DesktopOutboxRow[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bridge) return;
    const [c, q] = await Promise.all([bridge.conflicts(), bridge.outbox(null)]);
    setOpen(c ?? []);
    setQueue(q ?? []);
  }, []);

  // The main process pushes a status on every queue change, so re-reading here beats a second timer.
  useEffect(() => { void reload(); }, [reload, desktopStatus]);

  const resolve = async (c: DesktopConflict, choice: 'keep_server' | 'reapply_mine') => {
    if (!bridge) return;
    const reason = (reasons[c.id] ?? '').trim();
    // sync.resolve rejects a reason-less resolution on the server; the UI never offers one either.
    if (reason.length < 2) {
      toast(ur ? 'تضاد حل کرنے کے لیے وجہ درکار ہے' : 'A reason is required to resolve a conflict', 'err');
      return;
    }
    setBusy(`${c.id}:${choice}`);
    const r = await bridge.resolveConflict(c.id, choice, reason);
    setBusy(null);
    if (!r.ok) {
      toast(r.error ?? (ur ? 'تضاد حل نہیں ہو سکا' : 'That conflict could not be resolved'), 'err');
      return;
    }
    setReasons((p) => ({ ...p, [c.id]: '' }));
    toast(ur ? 'تضاد حل ہو گیا' : 'Conflict resolved');
    await reload();
  };

  if (!isDesktop) return null;
  const status = desktopStatus;
  const queueError = status?.error ?? null;
  const reasonWhy = (r: string) => ({
    VERSION: ur ? 'اسی نمبر پر دوسرے آلے نے پہلے لکھا' : 'another device wrote this document first',
    NOT_PERMITTED: ur ? 'اس آلے کو یہ اجازت نہیں' : 'this device is not permitted to post it',
    INVALID: ur ? 'اندراج سرور پر تصدیق نہیں ہوا' : 'the entry did not validate on the server',
  } as Record<string, string>)[r] ?? r;

  return <div>
    <div className="between">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm no-print erp-back-btn" onClick={() => nav(-1)}
          aria-label={ur ? 'پیچھے جائیں' : 'Go back'}>
          <span className="back-arrow">{ur ? '›' : '‹'}</span> {ur ? 'واپس' : 'Back'}
        </button>
        <h1>{ur ? 'ڈیسک ٹاپ سنک' : 'Desktop Sync'}</h1>
      </div>
      <Button loading={syncing} onClick={async () => {
        const r = await syncNow();
        toast(ur ? `${r.sent} سنک ہوئے، ${r.conflicts} تضاد` : `${r.sent} sent, ${r.conflicts} conflicts`);
        await reload();
      }}>{ur ? 'ابھی سنک کریں' : 'Sync Now'}</Button>
    </div>

    <div className="stats-grid">
      <StatCard label={ur ? 'نیٹ ورک' : 'Network'}
        value={online ? (status?.reachable === false ? (ur ? 'سرور تک رسائی نہیں' : 'Server unreachable') : (ur ? 'آن لائن' : 'Online')) : (ur ? 'آف لائن' : 'Offline')} />
      <StatCard label={ur ? 'قطار میں' : 'Queued'} value={pending} />
      <StatCard label={ur ? 'کھلے تضادات' : 'Open conflicts'} value={conflicts} tone={conflicts ? 'var(--danger)' : undefined} />
      <StatCard label={ur ? 'آخری سنک' : 'Last sync'} value={lastSync ?? '—'} />
    </div>

    {status?.config_error && <div className="notice small" style={{ marginBlock: 12 }} role="alert">
      {ur ? 'ترتیبات کی خرابی' : 'Configuration problem'}: {status.config_error}</div>}
    {queueError && <div className="notice small" style={{ marginBlock: 12 }} role="alert">
      {ur ? 'آخری سنک کی خرابی' : 'Last sync error'}: {queueError}</div>}
    <div className="notice info small" style={{ marginBlock: 12 }}>{ur
      ? 'آف لائن کیے گئے اندراج اسی کمپیوٹر کی SQLite قطار میں رہتے ہیں اور رسائی ہوتے ہی خودکار طور پر بھیجے جاتے ہیں۔ دو آلات نے ایک ہی دستاویز بدلی تو خاموش اوور رائٹ نہیں ہوتا — نیچے تضاد آتا ہے اور آپ خود چنتے ہیں کون سا ورژن رکھنا ہے۔'
      : 'Entries made offline stay in this computer’s SQLite queue and are pushed automatically when the connection returns. If two devices changed the same document there is no silent overwrite — it appears below and you choose which version stays.'}</div>

    <div className="card" style={{ marginBlock: 16 }}>
      <h2>{ur ? 'کھلے تضادات' : 'Open Conflicts'}</h2>
      {!open.length
        ? <EmptyState title={ur ? 'کوئی تضاد نہیں — سب کچھ سرور سے مطابقت رکھتا ہے' : 'No conflicts — everything matches the server'} />
        : open.map((c) => {
          const ready = (reasons[c.id] ?? '').trim().length >= 2;
          return <div key={c.id} className="card" style={{ marginBlock: 12, padding: 12 }}>
            <div className="between">
              <div>
                <strong>{c.entity}</strong> <span className="small">{c.row_id}</span>
              </div>
              <StatusChip status="CONFLICT" />
            </div>
            <div className="small" style={{ marginBlock: 6 }}>
              {ur ? 'وجہ' : 'Why'}: {reasonWhy(c.reason)} · {stamp(c.created_at)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              <div>
                <div className="small"><strong>{ur ? 'آپ کی نقل (اس کمپیوٹر پر)' : 'Your copy (this computer)'}</strong></div>
                <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'start', margin: 0 }}>{pretty(c.local_data)}</pre>
              </div>
              <div>
                <div className="small"><strong>{ur ? 'سرور پر' : 'On the server'}</strong></div>
                <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'start', margin: 0 }}>{pretty(c.server_data)}</pre>
              </div>
            </div>
            <div style={{ marginBlockStart: 10 }}>
              <TextField label={ur ? 'وجہ (لازمی)' : 'Reason (required)'} value={reasons[c.id] ?? ''}
                onChange={(v) => setReasons((p) => ({ ...p, [c.id]: v }))} required
                helper={ur ? 'یہ وجہ آڈٹ لاگ میں محفوظ ہوتی ہے' : 'The reason is written to the audit log'} />
            </div>
            <div className="btn-row">
              <Button variant="secondary" disabled={!ready} loading={busy === `${c.id}:keep_server`}
                onClick={() => void resolve(c, 'keep_server')}>
                {ur ? 'سرور والا رکھیں' : 'Keep server version'}
              </Button>
              <Button variant="danger" disabled={!ready} loading={busy === `${c.id}:reapply_mine`}
                onClick={() => void resolve(c, 'reapply_mine')}>
                {ur ? 'میرا ورژن لگاؤ' : 'Reapply my version'}
              </Button>
            </div>
          </div>;
        })}
    </div>

    <div className="card">
      <h2>{ur ? 'مقامی قطار' : 'Local Queue'}</h2>
      <DataTable rows={queue} csvName="desktop-outbox" columns={[
        { key: 'type', label: ur ? 'قسم' : 'Type' },
        { key: 'status', label: ur ? 'حالت' : 'Status', render: (r) => <StatusChip status={String(r.status ?? '')} /> },
        { key: 'tries', label: ur ? 'کوششیں' : 'Tries' },
        { key: 'server_number', label: ur ? 'سرور نمبر' : 'Reference No' },
        { key: 'error', label: ur ? 'خرابی' : 'Error' },
        { key: 'created_at', label: ur ? 'وقت' : 'Time', render: (r) => <span>{stamp(r.created_at)}</span> },
      ] as Column[]} /></div>
  </div>;
}
