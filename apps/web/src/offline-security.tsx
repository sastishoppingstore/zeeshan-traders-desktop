/** Optional PIN-derived AES-GCM encryption of the offline IndexedDB cache (spec Part 8).
 *
 *  PBKDF2-SHA256 with 310,000 iterations derives a non-extractable AES-256-GCM key from the PIN.
 *  While enabled, the role-scoped `refs` cache and offline `drafts` are ALWAYS stored encrypted;
 *  the key lives only in memory for the current tab session and is dropped on lock/logout/reload.
 *  The Dexie `outbox` stays readable so queued operations can still sync; it is wiped on logout.
 *  The site never sees a fingerprint/biometric and never transmits or stores the PIN.
 */
import React, { useState } from 'react';
import { ztdb } from './cache-db.js';
import { Mark } from './ui/marks.js';

import {
  PIN_ITERATIONS, VERIFY_PLAINTEXT, type EncBlob, isEnc, b64, unb64,
  derivePinKey, encryptJson, decryptJson,
} from './pin-crypto.js';
export { PIN_ITERATIONS } from './pin-crypto.js';

const SALT_KEY = 'zt_pin_salt';
const VERIFY_KEY = 'zt_pin_verifier';
const CHANGE_EVENT = 'zt-pin-change';

let activeKey: CryptoKey | null = null;

export const pinEnabled = () => !!localStorage.getItem(SALT_KEY) && !!localStorage.getItem(VERIFY_KEY);
export const pinUnlocked = () => activeKey !== null;
const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT));

const derive = derivePinKey;
const enc = encryptJson;
const dec = decryptJson;

/** Convert every plaintext ref/draft row to ciphertext using the freshly derived key. */
async function encryptAll(key: CryptoKey) {
  for (const row of await ztdb.refs.toArray())
    if (!isEnc(row.data)) await ztdb.refs.put({ ...row, data: await enc(key, row.data) });
  for (const row of await ztdb.drafts.toArray())
    if (!isEnc(row.data)) await ztdb.drafts.put({ ...row, data: await enc(key, row.data) });
}
async function decryptAll(key: CryptoKey) {
  for (const row of await ztdb.refs.toArray())
    if (isEnc(row.data)) await ztdb.refs.put({ ...row, data: await dec(key, row.data) });
  for (const row of await ztdb.drafts.toArray())
    if (isEnc(row.data)) await ztdb.drafts.put({ ...row, data: await dec(key, row.data) });
}

export async function enablePin(pin: string): Promise<void> {
  if (pin.length < 4 || pin.length > 12 || !/^\d+$/.test(pin)) throw new Error('PIN 4–12 ہندسوں کا ہونا چاہئے');
  if (pinEnabled()) throw new Error('PIN پہلے سے فعال ہے');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(pin, salt);
  localStorage.setItem(SALT_KEY, b64(salt));
  localStorage.setItem(VERIFY_KEY, JSON.stringify(await enc(key, VERIFY_PLAINTEXT)));
  await encryptAll(key);
  activeKey = key;
  notify();
}

export async function unlockPin(pin: string): Promise<boolean> {
  if (!pinEnabled()) return true;
  const salt = unb64(localStorage.getItem(SALT_KEY)!);
  const key = await derive(pin, salt);
  try {
    const verifier = JSON.parse(localStorage.getItem(VERIFY_KEY)!) as EncBlob;
    const ok = (await dec(key, verifier)) === VERIFY_PLAINTEXT;
    if (ok) { activeKey = key; notify(); }
    return ok;
  } catch { activeKey = null; return false; }
}

export function lockPin() { activeKey = null; notify(); }
/** Called on logout: cache is cleared, PIN stays configured, next login requires the PIN again. */
export function markLocked() { activeKey = null; notify(); }

export async function disablePin(pin: string): Promise<void> {
  if (!pinEnabled()) return;
  if (!(await unlockPin(pin))) throw new Error('PIN درست نہیں');
  const key = activeKey!;
  await decryptAll(key);
  localStorage.removeItem(SALT_KEY);
  localStorage.removeItem(VERIFY_KEY);
  activeKey = null;
  notify();
}

/** Wipe the encrypted offline cache when the PIN is lost (never touches queued outbox operations). */
export async function wipeEncryptedCache() {
  await ztdb.refs.clear(); await ztdb.drafts.clear();
  localStorage.removeItem(SALT_KEY); localStorage.removeItem(VERIFY_KEY);
  activeKey = null; notify();
}

/** Role-scoped cache writes: encrypted when a PIN is configured, skipped while locked. */
export async function cacheRef(kind: string, data: unknown): Promise<void> {
  if (!pinEnabled()) { await ztdb.refs.put({ key: kind, kind, data }); return; }
  if (!activeKey) return; // locked: never write plaintext
  await ztdb.refs.put({ key: kind, kind, data: await enc(activeKey, data) });
}
export async function readRef(kind: string): Promise<unknown | null> {
  const row = await ztdb.refs.get(kind);
  if (!row) return null;
  if (isEnc(row.data)) { if (!activeKey) return null; return dec(activeKey, row.data); }
  return row.data;
}
export async function saveDraft(key: string, data: unknown): Promise<void> {
  await ztdb.drafts.put({ key, data: pinEnabled() && activeKey ? await enc(activeKey, data) : data });
}
export async function readDrafts(): Promise<unknown[]> {
  const rows = await ztdb.drafts.toArray();
  const out: unknown[] = [];
  for (const r of rows) {
    if (isEnc(r.data)) { if (activeKey) out.push(await dec(activeKey, r.data)); }
    else out.push(r.data);
  }
  return out;
}

export function usePinState(): { enabled: boolean; unlocked: boolean } {
  const [state, setState] = useState(() => ({ enabled: pinEnabled(), unlocked: pinUnlocked() }));
  React.useEffect(() => {
    const on = () => setState({ enabled: pinEnabled(), unlocked: pinUnlocked() });
    window.addEventListener(CHANGE_EVENT, on);
    return () => window.removeEventListener(CHANGE_EVENT, on);
  }, []);
  return state;
}

/** Full-screen gate shown inside /erp when the encrypted cache is locked. */
export function PinGate() {
  const [pin, setPin] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  return <div className="center" style={{ minHeight: '100vh', padding: 24 }}>
    <img src="/icons/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 14, marginInline: 'auto' }} />
    <h1 className="h-nastaliq">آف لائن کیش مقفل ہے</h1>
    <div className="card" style={{ maxWidth: 380, marginInline: 'auto' }}>
      <p className="small">اپنا PIN درج کریں۔ PIN سے PBKDF2 ({PIN_ITERATIONS.toLocaleString('en-PK')} iterations) کے ذریعے
        AES-256-GCM چابی بنتی ہے؛ PIN کہیں محفوظ یا بھیجا نہیں جاتا۔</p>
      <div className="field"><label htmlFor="zt-pin">PIN</label>
        <input id="zt-pin" className="input" type="password" inputMode="numeric" autoComplete="off"
          value={pin} onChange={(e) => setPin(e.target.value)} aria-invalid={!!err}
          onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('zt-pin-unlock') as HTMLButtonElement | null)?.click(); }} />
      </div>
      {err && <div className="err" role="alert"><Mark kind="warn" /> {err}</div>}
      <button id="zt-pin-unlock" className="btn btn-primary btn-block" disabled={busy || pin.length < 4}
        onClick={async () => {
          setBusy(true); setErr('');
          try { const ok = await unlockPin(pin); if (!ok) setErr('PIN درست نہیں'); }
          catch { setErr('کھولنے میں خرابی'); } finally { setBusy(false); }
        }}>{busy ? 'چابی بن رہی ہے…' : 'کھولیں'}</button>
      <div className="notice small" style={{ marginBlockStart: 14 }}>PIN بھول گئے؟ مقفل کیش صاف کی جا سکتی ہے؛
        آن لائن ڈیٹا محفوظ رہتا ہے اور سنک کی قطار متاثر نہیں ہوتی۔</div>
      {!confirmWipe ? <button className="btn btn-ghost btn-sm" onClick={() => setConfirmWipe(true)}>کیش صاف کریں</button> :
        <button className="btn btn-danger btn-sm" onClick={async () => { await wipeEncryptedCache(); }}>تصدیق: کیش مٹائیں</button>}
    </div>
  </div>;
}
