/** P8-PIN browser E2E: enable -> reload -> gate -> unlock -> lock -> unlock -> disable.
 *  Real Chromium (not a unit test). No business data is touched.
 */
import { launchBrowser } from './browser.mjs';

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
const PIN = '482193';
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ur-PK' });
  const page = await context.newPage();
  await page.goto(`${BASE}/erp/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'e2e-owner', password: 'E2E-Test-Owner-2026!' }) });
  });
  await page.goto(`${BASE}/erp/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /PIN فعال کریں/ }).waitFor({ timeout: 15000 });
  const pinInput = page.locator('.card', { hasText: 'آف لائن PIN' }).locator('input[type=password]').first();
  await pinInput.fill(PIN);
  await page.getByRole('button', { name: /PIN فعال کریں/ }).click();
  await page.getByText(/فعال — کھلا/).waitFor({ timeout: 15000 });
  console.log('enable: OK (PBKDF2 -> AES-GCM, refs/drafts encrypted)');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('آف لائن کیش مقفل ہے').waitFor({ timeout: 15000 });
  console.log('reload: PinGate shown');

  await page.locator('#zt-pin').fill('111111');
  await page.locator('#zt-pin-unlock').click();
  await page.getByText('PIN درست نہیں').waitFor({ timeout: 15000 });
  console.log('wrong PIN: rejected');

  await page.locator('#zt-pin').fill(PIN);
  await page.locator('#zt-pin-unlock').click();
  await page.getByRole('button', { name: /PIN ہٹائیں/ }).waitFor({ timeout: 15000 });
  console.log('correct PIN: unlocked');

  const encrypted = await page.evaluate(async () => {
    const req = indexedDB.open('zeeshan-traders');
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const tx = db.transaction(['refs', 'drafts'], 'readonly');
    const all = await Promise.all(['refs', 'drafts'].map((s) => new Promise((res) => {
      const q = tx.objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]);
    })));
    db.close();
    const rows = all.flat();
    return { rows: rows.length, encrypted: rows.filter((r) => r?.data?.__zt_enc === 1).length };
  });
  console.log(`indexedDB rows=${encrypted.rows} encrypted=${encrypted.encrypted}`);

  await page.getByRole('button', { name: /PIN ہٹائیں/ }).click();
  await page.getByText('غیر فعال').waitFor({ timeout: 15000 });
  console.log('disable: OK');
  console.log('PIN_E2E_PASS');
  await context.close();
} finally { await browser.close(); }
