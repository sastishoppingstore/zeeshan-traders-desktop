/**
 * PWA install. Android/Chrome hands the app a `beforeinstallprompt` event that a tap can turn
 * into the native installer; iOS never fires it, so that platform gets the manual
 * "Add to Home Screen" path instead. A dismissal is remembered for three days — a nudge, not a nag.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-state.js';
import { Button } from '../components.js';

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'zt-install-dismissed-at';
const REASK_AFTER = 3 * 24 * 60 * 60 * 1000;

/** Already running as an installed app — never offer the sheet again. */
function isStandalone() {
  const mq = (q: string) => window.matchMedia?.(q).matches;
  return mq('(display-mode: standalone)') || mq('(display-mode: window-controls-overlay)')
    || mq('(display-mode: minimal-ui)')
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Safari on iPhone/iPad: installable, but only through its own share sheet. */
function isIOSWithoutInstall() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
}

export function InstallPrompt() {
  const { lang } = useApp();
  const ur = lang === 'ur';
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    setOpen(false);
  };

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as PromptEvent);
    };
    const onInstalled = () => { setDeferred(null); setOpen(false); };
    const onManualOpen = () => setOpen(true);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('zt:open-install', onManualOpen);

    if (isIOSWithoutInstall()) setIsIOS(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('zt:open-install', onManualOpen);
    };
  }, []);

  // Show automatic popup after a polite delay unless dismissed within the last 3 days
  useEffect(() => {
    if (isStandalone()) return;
    let ago = Infinity;
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY));
      if (at) ago = Date.now() - at;
    } catch { /* private mode: show anyway */ }
    if (ago < REASK_AFTER) return;
    const timer = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    card.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const install = async () => {
    if (deferred) {
      setBusy(true);
      try {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') { setDeferred(null); setOpen(false); }
        else dismiss();
      } catch { dismiss(); } finally { setBusy(false); }
    } else {
      dismiss();
    }
  };

  if (!open) return null;
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    role="dialog" aria-modal="true" aria-labelledby="install-title">
    <div className="install-card" ref={card}>
      <span className="handle" aria-hidden="true" />
      <img className="install-icon" src="/brand/logo-96.webp" alt="" width={56} height={56} />
      <h2 id="install-title">{ur ? 'ایپ طور پر انسٹال کریں' : 'Install the app'}</h2>
      <p>{ur
        ? 'دکان، آج کے ریٹ اور کھاتہ ہوم اسکرین پر — آف لائن بھی کھلتا ہے۔'
        : 'The shop, today’s rates and your ledger on the home screen — it opens offline too.'}</p>
      
      {isIOS ? (
        <ol className="install-steps">
          <li>{ur ? 'Safari کے نیچے «شیئر» پر ٹیپ کریں۔' : 'Tap “Share” at the bottom of Safari.'}</li>
          <li>{ur ? '«ہوم اسکرین پر شامل کریں» چنیں۔' : 'Choose “Add to Home Screen”.'}</li>
          <li>{ur ? 'دوبارہ «شامل کریں» — نشان ہوم اسکرین پر آ جائے گا۔' : 'Tap “Add” — the mark appears on your home screen.'}</li>
        </ol>
      ) : !deferred ? (
        <ol className="install-steps">
          <li>{ur ? 'براؤزر مینو (تین نقطے ⋮) پر ٹیپ کریں۔' : 'Tap the browser menu (three dots ⋮).'}</li>
          <li>{ur ? '«ایپ انسٹال کریں» یا «ہوم اسکرین پر شامل کریں» چنیں۔' : 'Select “Install App” or “Add to Home Screen”.'}</li>
        </ol>
      ) : null}

      <div className="install-actions">
        {deferred ? (
          <Button loading={busy} onClick={install} className="btn-block">
            {ur ? 'ابھی انسٹال کریں' : 'Install Now'}
          </Button>
        ) : (
          <Button onClick={dismiss} className="btn-block">
            {ur ? 'سمجھ گیا' : 'Got it'}
          </Button>
        )}
        <Button variant="ghost" onClick={dismiss}>{ur ? 'بعد میں' : 'Later'}</Button>
      </div>
    </div>
  </div>;
}
