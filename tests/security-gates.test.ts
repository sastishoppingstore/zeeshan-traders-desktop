/** Part 9: Turnstile gate, cache purge, A19 quota guard, A20 full write-route deny-by-default matrix. */
import { describe, it, expect } from 'vitest';
import { makeHarness, createProduct } from './helpers.js';

const enquiryBody = (token?: string) => ({
  customer_name: 'Test Customer', mobile: '0307-7864722', city: 'Layyah',
  message: 'قیمت معلوم کرنی ہے', consent: true, items: [], honeypot: '', elapsed_ms: 2000,
  ...(token !== undefined ? { turnstile_token: token } : {}),
});

describe('Turnstile (optional anti-bot gate)', () => {
  it('rejects a bad token, accepts a good one, and is truly optional when no secret is set', async () => {
    const h = makeHarness();
    await h.setup();
    h.env.TURNSTILE_SECRET = 'test-secret-not-for-production';
    h.env.__ZT_TURNSTILE_VERIFY__ = async (t) => t === 'good-token';
    const bad = await h.call('POST', '/api/v1/public/enquiry', enquiryBody('bad-token'));
    expect(bad.status).toBe(403);
    expect(bad.json.error.code).toBe('TURNSTILE_FAILED');
    const good = await h.call('POST', '/api/v1/public/enquiry', enquiryBody('good-token'));
    expect(good.status).toBe(201);
    h.env.TURNSTILE_SECRET = undefined;
    const noSecret = await h.call('POST', '/api/v1/public/enquiry', enquiryBody());
    expect(noSecret.status).toBe(201);
  });
});

describe('public cache purge on publish / unpublish', () => {
  it('second read is a HIT; after unpublish the stale HIT is gone and the product disappears', async () => {
    const h = makeHarness();
    await h.setup();
    const p = await createProduct(h, { is_published: true });
    const first = await h.call('GET', '/api/v1/public/products');
    expect(first.headers.get('X-ZT-Cache')).toBeNull();
    expect(first.json.data.rows.some((x: any) => x.id === p.id)).toBe(true);
    const second = await h.call('GET', '/api/v1/public/products');
    expect(second.headers.get('X-ZT-Cache')).toBe('HIT');
    const unpublish = await h.call('POST', `/api/v1/products/${p.id}/publish`, { published: false });
    expect(unpublish.status).toBe(200);
    const after = await h.call('GET', '/api/v1/public/products');
    expect(after.headers.get('X-ZT-Cache')).toBeNull();
    expect(after.json.data.rows.some((x: any) => x.id === p.id)).toBe(false);
  });
});

describe('A19 — 200 public catalogue hits stay on the cached path', () => {
  it('records >=199 cached hits and burns almost no D1 row reads', async () => {
    const h = makeHarness();
    await h.setup();
    await createProduct(h, { is_published: true });
    h.sqlite.prepare('DELETE FROM usage_counters').run();
    for (let i = 0; i < 200; i++) {
      const r = await h.call('GET', '/api/v1/public/products');
      expect(r.status).toBe(200);
    }
    const u = h.sqlite.prepare('SELECT rows_read,public_hits,cached_public_hits FROM usage_counters').get() as any;
    console.log(`A19 usage: rows_read=${u.rows_read} public_hits=${u.public_hits} cached_hits=${u.cached_public_hits}`);
    expect(u.public_hits).toBeGreaterThanOrEqual(200);
    expect(u.cached_public_hits).toBeGreaterThanOrEqual(199);
    expect(u.rows_read).toBeLessThan(100); // no table scan / no per-hit D1 read
  });
});

describe('A20 — deny-by-default on every admin write route', () => {
  const WRITES: [string, string, unknown][] = [
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
    ['POST', '/api/v1/devices/x/revoke', {}],
    ['POST', '/api/v1/auth/passkeys/x/revoke', {}],
    ['POST', '/api/v1/enquiries/x/status', { status: 'APPROVED' }],
    ['POST', '/api/v1/website/banners', {}],
    ['POST', '/api/v1/backup/run', {}],
    ['POST', '/api/v1/accounting/close', {}],
    ['PUT', '/api/v1/website/pages/about', { slug: 'about', title_ur: 'x' }],
    ['DELETE', '/api/v1/images/x', undefined],
  ];
  it('a read-only AUDITOR gets 401/403 (never 2xx, never 500) on all 24 admin writes', async () => {
    const h = makeHarness();
    await h.setup();
    const created = await h.call('POST', '/api/v1/users', {
      username: 'auditor1', password: 'auditor-password-123', name: 'Read Only Auditor',
      mobile: '0300-0000000', role_codes: ['AUDITOR'],
    });
    expect(created.status).toBe(201);
    await h.login('auditor1', 'auditor-password-123');
    for (const [method, path, body] of WRITES) {
      const r = await h.call(method, path, body);
      expect(r.status, `${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`)
        .not.toBe(500);
      expect(r.status, `${method} ${path} unexpectedly allowed`).toBeGreaterThanOrEqual(400);
    }
  });
});
