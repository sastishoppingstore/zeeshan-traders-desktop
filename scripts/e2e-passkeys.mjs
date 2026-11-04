/** A15 E2E: real Chromium + CDP virtual authenticator (NOT a physical phone).
 *  Password setup -> register passkey -> logout -> passkey login -> revoke -> login denied.
 *  Run against `npm run server` on http://localhost:3000 with a FRESH local DB.
 */
import { launchBrowser, addVirtualAuthenticator } from './browser.mjs';

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
const out = (k, v) => console.log(`${k}: ${v}`);

const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ur-PK' });
  const page = await context.newPage();
  const { cdp } = await addVirtualAuthenticator(context, page);

  await page.goto(`${BASE}/erp/login`, { waitUntil: 'domcontentloaded' });

  // One-time owner setup through the real API (test-only owner, no business data invented).
  const setup = await page.evaluate(async () => {
    const st = await (await fetch('/api/v1/setup/status')).json();
    const token = st.data.setup_token;
    const res = await fetch('/api/v1/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup_token: token,
        owner: { name: 'E2E Test Owner', username: 'e2e-owner', mobile: '0307-7864722', password: 'E2E-Test-Owner-2026!' },
        maund_kg: 40, maund_confirmed: true, opening_balances: [],
      }),
    });
    return { status: res.status, body: await res.json() };
  });
  out('setup', `${setup.status} ${setup.body.ok}`);
  if (setup.status !== 201) throw new Error(`setup failed: ${JSON.stringify(setup.body)}`);

  await page.goto(`${BASE}/erp/users`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /اپنی پاس کی رجسٹر کریں/ }).waitFor({ timeout: 15000 });
  const verifyPromise = page.waitForResponse(
    (r) => r.url().includes('/passkey/register/verify'), { timeout: 20000 });
  await page.getByRole('button', { name: /اپنی پاس کی رجسٹر کریں/ }).click();
  const verifyRes = await verifyPromise;
  const verifyJson = await verifyRes.json();
  out('register', `${verifyRes.status()} verified=${verifyJson?.data?.verified} credential=${String(verifyJson?.data?.credential_id ?? '').slice(0, 12)}…`);
  if (verifyRes.status() !== 201 || !verifyJson?.data?.verified) throw new Error('passkey registration failed');

  const passkeys = await page.evaluate(async () => (await (await fetch('/api/v1/auth/passkeys')).json()).data);
  out('passkey_rows', passkeys.length);
  if (passkeys.length !== 1) throw new Error('expected exactly 1 registered passkey');

  // Logout through the real endpoint, then clear cookies to simulate a fresh browser.
  await page.evaluate(async () => {
    const csrf = /(?:^|;\s*)zt_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
    await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) }, body: '{}' });
  });
  await context.clearCookies();
  await page.goto(`${BASE}/erp/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /فنگر پرنٹ \/ پاس کی سے لاگ ان/ }).waitFor({ timeout: 15000 });
  const loginPromise = page.waitForResponse(
    (r) => r.url().includes('/passkey/authenticate/verify'), { timeout: 20000 });
  await page.getByRole('button', { name: /فنگر پرنٹ \/ پاس کی سے لاگ ان/ }).click();
  const loginRes = await loginPromise;
  const loginJson = await loginRes.json();
  out('passkey_login', `${loginRes.status()} method=${loginJson?.data?.method}`);
  if (loginRes.status() !== 200 || loginJson?.data?.method !== 'passkey') throw new Error('passkey login failed');
  await page.waitForURL(/\/erp$/, { timeout: 15000 }).catch(() => {});
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/me'); return { status: r.status, body: await r.json() };
  });
  out('auth_me_after_passkey', `${me.status} user=${me.body?.data?.user?.username ?? '-'}`);
  if (me.status !== 200) throw new Error('session not established after passkey login');

  // Revoke the passkey, then prove it can no longer authenticate.
  const revoked = await page.evaluate(async () => {
    const list = (await (await fetch('/api/v1/auth/passkeys')).json()).data;
    const csrf = /(?:^|;\s*)zt_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
    const r = await fetch(`/api/v1/auth/passkeys/${list[0].id}/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) }, body: '{}',
    });
    return { status: r.status, body: await r.json() };
  });
  out('revoke', `${revoked.status} ${revoked.body?.data?.revoked}`);
  if (revoked.status !== 200) throw new Error('revoke failed');

  await page.evaluate(async () => {
    const csrf = /(?:^|;\s*)zt_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
    await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) }, body: '{}' });
  });
  await context.clearCookies();
  await page.goto(`${BASE}/erp/login`, { waitUntil: 'domcontentloaded' });
  const deniedPromise = page.waitForResponse(
    (r) => r.url().includes('/passkey/authenticate/verify'), { timeout: 20000 });
  await page.getByRole('button', { name: /فنگر پرنٹ \/ پاس کی سے لاگ ان/ }).click();
  const denied = await deniedPromise;
  const deniedJson = await denied.json();
  out('revoked_login', `${denied.status()} ${deniedJson?.error?.code}`);
  if (denied.status() === 200) throw new Error('revoked passkey still logged in!');

  // Password fallback still works after passkey revoke.
  const fallback = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'e2e-owner', password: 'E2E-Test-Owner-2026!' }) });
    return { status: r.status, body: await r.json() };
  });
  out('password_fallback', `${fallback.status} ${fallback.body?.ok}`);
  if (fallback.status !== 200) throw new Error('password fallback broken');

  await cdp.detach().catch(() => {});
  console.log('A15_E2E_PASS');
} finally {
  await browser.close();
}
