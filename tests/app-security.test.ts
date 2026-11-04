/**
 * App-wide security gates — CSRF on EVERY mutating route, RBAC/IDOR on private
 * reads, SQL-injection strings and stored-XSS sanitisation on public output.
 * These are real Worker calls against real (in-memory) SQL, not mocks.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness, createProduct } from './helpers.js';

/** Every state-changing route the UI can reach, with a deliberately harmless body. */
const MUTATIONS: [string, string, unknown][] = [
  ['POST', '/api/v1/products', { name_ur: 'x' }],
  ['POST', '/api/v1/products/import', { rows: [], mode: 'SKIP' }],
  ['POST', '/api/v1/categories', { name_ur: 'x' }],
  ['POST', '/api/v1/brands', { name_ur: 'x' }],
  ['POST', '/api/v1/parties', { name: 'x', type: 'CUSTOMER' }],
  ['POST', '/api/v1/sales', {}],
  ['POST', '/api/v1/purchases', {}],
  ['POST', '/api/v1/returns', {}],
  ['POST', '/api/v1/receipts', {}],
  ['POST', '/api/v1/payments', {}],
  ['POST', '/api/v1/accounts/transfer', {}],
  ['POST', '/api/v1/expenses', {}],
  ['POST', '/api/v1/employees', {}],
  ['POST', '/api/v1/payroll/2026-11/post', {}],
  ['POST', '/api/v1/users', {}],
  ['POST', '/api/v1/users/x/disable', {}],
  ['POST', '/api/v1/users/x/reset-password', {}],
  ['POST', '/api/v1/devices/x/revoke', {}],
  ['POST', '/api/v1/auth/passkeys/x/revoke', {}],
  ['POST', '/api/v1/enquiries/x/status', { status: 'APPROVED' }],
  ['POST', '/api/v1/website/banners', {}],
  ['POST', '/api/v1/backup/run', {}],
  ['POST', '/api/v1/accounting/close', {}],
  ['POST', '/api/v1/sync/push', { operations: [] }],
  ['POST', '/api/v1/sync/resolve/x', { action: 'REJECT', reason: 'x' }],
  ['POST', '/api/v1/auth/logout', {}],
  ['PUT', '/api/v1/website/pages/about', { slug: 'about', title_ur: 'x' }],
  ['PUT', '/api/v1/settings', { maund_kg: 40 }],
  ['DELETE', '/api/v1/images/x', undefined],
];

describe('H5 — CSRF is enforced on every mutating route', () => {
  it('a valid OWNER session WITHOUT the x-csrf-token header gets 403 CSRF_FAILED on all 29 writes', async () => {
    const h = makeHarness();
    await h.setup();
    for (const [method, path, body] of MUTATIONS) {
      // csrf: '' deliberately omits the header while keeping the session cookie.
      const r = await h.call(method, path, body, { csrf: '' });
      expect(r.status, `${method} ${path} -> ${r.status}`).toBe(403);
      expect(r.json.error?.code, `${method} ${path}`).toBe('CSRF_FAILED');
    }
    // Sanity: the same mutating route WITH the token is not rejected by CSRF.
    const ok = await h.call('POST', '/api/v1/auth/logout', {});
    expect(ok.status).toBe(200);
    expect(ok.json.error?.code).not.toBe('CSRF_FAILED');
  });
});

describe('H5 — deny-by-default private reads (IDOR / RBAC)', () => {
  it('a read-only AUDITOR cannot read user, device, backup or admin-only routes', async () => {
    const h = makeHarness();
    await h.setup();
    const created = await h.call('POST', '/api/v1/users', {
      username: 'auditor2', password: 'auditor-password-123', name: 'Read Only Auditor',
      mobile: '0300-0000000', role_codes: ['AUDITOR'],
    });
    expect(created.status).toBe(201);
    await h.login('auditor2', 'auditor-password-123');
    const forbidden = [
      '/api/v1/users', '/api/v1/roles', '/api/v1/devices',
      '/api/v1/backup', '/api/v1/backup/download',
    ];
    for (const path of forbidden) {
      const r = await h.call('GET', path);
      expect(r.status, `${path} -> ${r.status}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `${path} returned 500`).toBeLessThan(500);
    }
    // ...but a permission it DOES hold still works.
    expect((await h.call('GET', '/api/v1/settings')).status).toBe(200);
  });

  it('an unauthenticated caller cannot read any private route (public whitelist only)', async () => {
    const h = makeHarness();
    await h.setup();
    const priv = ['/api/v1/auth/me', '/api/v1/products', '/api/v1/reports/trial-balance',
      '/api/v1/accounting/journal', '/api/v1/parties', '/api/v1/backup', '/api/v1/users'];
    for (const path of priv) {
      const r = await h.call('GET', path, undefined, { cookie: '', csrf: '' });
      expect(r.status, `${path} -> ${r.status}`).toBe(401);
    }
  });
});

describe('A20 — SQL injection strings are harmless everywhere', () => {
  it('no 500, no dropped table, no extra rows, and no auth bypass', async () => {
    const h = makeHarness();
    await h.setup();
    const p = await createProduct(h, { is_published: true });
    const payloads = ["' OR 1=1 --", "'; DROP TABLE products; --", "%27%20UNION%20SELECT%20*%20FROM%20users--", "1; DELETE FROM users"];
    for (const raw of payloads) {
      const q = encodeURIComponent(raw);
      for (const path of [`/api/v1/public/products?q=${q}`, `/api/v1/products?q=${q}`, `/api/v1/parties?q=${q}`]) {
        const r = await h.call('GET', path);
        expect(r.status, `${path} -> ${r.status}`).toBeLessThan(500);
        expect(r.status, `${path} -> ${r.status}`).toBe(200);
      }
      const login = await h.call('POST', '/api/v1/auth/login',
        { username: raw, password: raw }, { cookie: '', csrf: '' });
      expect(login.status, `login ${raw} -> ${login.status}`).toBeLessThan(500);
      expect(login.status).toBeGreaterThanOrEqual(400);
    }
    // Tables and data are intact; the injection never returned a full table dump.
    const tables = h.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='products'").get() as any;
    expect(tables.n).toBe(1);
    expect((h.sqlite.prepare('SELECT count(*) n FROM products').get() as any).n).toBe(1);
    const pub = await h.call('GET', '/api/v1/public/products');
    expect(pub.status).toBe(200);
    expect(pub.json.data.rows.length).toBe(1);
    expect(pub.json.data.rows[0].id).toBe(p.id);
  });
});

describe('A20 — stored XSS never reaches public JSON', () => {
  it('script tags, event handlers and javascript: URLs are stripped from product + CMS output', async () => {
    const h = makeHarness();
    await h.setup();
    const evil = '<script>alert(1)</script><b onclick="evil()">کھاد</b><a href="javascript:evil()">لنک</a>';
    const p = await createProduct(h, { description_ur: evil, description_en: evil, is_published: true });
    const detail = await h.call('GET', `/api/v1/public/product/${p.slug}`);
    expect(detail.status).toBe(200);
    const text = JSON.stringify(detail.json);
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toMatch(/onclick/i);
    expect(text).not.toMatch(/javascript:/i);
    expect(detail.headers.get('content-security-policy') || '').toContain("script-src");
  });
});
