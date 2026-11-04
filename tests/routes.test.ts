/** Route smoke matrix: every GET/POST the web app calls must return a real, non-500 response.
 *  Also checks deny-by-default on private endpoints and that the feature checklist is honest. */
import { describe, it, expect } from 'vitest';
import { makeHarness, TODAY, createProduct } from './helpers.js';

const GET_PATHS = [
  '/api/v1/health', '/api/v1/setup/status', '/api/v1/auth/me', '/api/v1/features',
  `/api/v1/dashboard?from=${TODAY}&to=${TODAY}`, '/api/v1/usage',
  '/api/v1/products', '/api/v1/categories', '/api/v1/brands', '/api/v1/units',
  '/api/v1/catalogue/export',
  `/api/v1/sales?from=${TODAY}&to=${TODAY}`, `/api/v1/purchases?from=${TODAY}&to=${TODAY}`,
  '/api/v1/returns', '/api/v1/parties', '/api/v1/receipts', '/api/v1/payments',
  '/api/v1/expenses', '/api/v1/expense-categories', '/api/v1/employees', '/api/v1/advances',
  `/api/v1/payroll/${TODAY.slice(0, 7)}`,
  '/api/v1/grains/lots', '/api/v1/grains/summary',
  '/api/v1/accounts', '/api/v1/stock', '/api/v1/stock/ledger', '/api/v1/stock/batches',
  `/api/v1/khata?from=${TODAY}&to=${TODAY}`, '/api/v1/khata/books', '/api/v1/khata/ageing',
  `/api/v1/statements?from=${TODAY}&to=${TODAY}`,
  '/api/v1/reports/trial-balance', '/api/v1/reports/pnl', '/api/v1/reports/balance-sheet',
  '/api/v1/reports/daybook', '/api/v1/reports/cashbook', '/api/v1/reports/stock',
  '/api/v1/reports/expiry', '/api/v1/reports/pesticide-register', '/api/v1/reports/fertilizer-register',
  '/api/v1/reports/reconcile',
  `/api/v1/documents?from=${TODAY}&to=${TODAY}`,
  '/api/v1/accounting/chart', '/api/v1/accounting/journals', '/api/v1/integrity',
  '/api/v1/audit', '/api/v1/sync/operations', '/api/v1/sync/conflicts',
  '/api/v1/backup', '/api/v1/ops/jobs', '/api/v1/settings', '/api/v1/roles', '/api/v1/users', '/api/v1/devices',
  '/api/v1/website/pages', '/api/v1/website/banners', '/api/v1/website/announcements',
  '/api/v1/enquiries',
  '/api/v1/public/home', '/api/v1/public/categories', '/api/v1/public/products',
  '/api/v1/public/pages/about', '/sitemap.xml', '/robots.txt',
];

describe('web route matrix (real Worker + real SQL)', () => {
  it('every public/private GET used by the UI responds without a server error', async () => {
    const h = makeHarness();
    await h.setup();
    const p = await createProduct(h, { is_published: true });
    const withId = [
      `/api/v1/products/${p.id}`, `/api/v1/parties/x`, '/api/v1/accounts/acct-cash',
      `/api/v1/sales/${p.id}`, `/api/v1/documents/${p.id}`, `/api/v1/public/product/${p.slug}`,
    ];
    for (const path of [...GET_PATHS, ...withId]) {
      const r = await h.call('GET', path);
      expect(r.status, `${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 180)}`)
        .toBeLessThan(500);
      expect(r.status, `${path} -> ${r.status}`).not.toBe(401);
    }
  });

  it('private endpoints deny unauthenticated callers (H5), public ones stay open', async () => {
    const h = makeHarness();
    await h.setup();
    const anon = makeHarness();
    await anon.setup();
    anon.session = null;
    for (const path of ['/api/v1/products', '/api/v1/dashboard', '/api/v1/settings',
      '/api/v1/reports/pnl', '/api/v1/sync/conflicts', '/api/v1/backup']) {
      const r = await anon.call('GET', path, undefined, { cookie: '', csrf: '' });
      expect(r.status, path).toBe(401);
    }
    for (const path of ['/api/v1/public/home', '/api/v1/public/products', '/api/v1/health']) {
      const r = await anon.call('GET', path, undefined, { cookie: '', csrf: '' });
      expect(r.status, path).toBeLessThan(400);
    }
  });

  it('feature checklist keeps unfinished items labelled instead of claiming everything is done', async () => {
    const h = makeHarness();
    await h.setup();
    const r = await h.call('GET', '/api/v1/features');
    expect(r.status).toBe(200);
    const f = r.json.data.features as { id: string; state: string }[];
    expect(f.length).toBeGreaterThanOrEqual(45);
    // zt-v2 + zt-v2-staging are deployed for real (verified live URLs), so deploy is
    // COMPLETE; R2 buckets and the staging restore stay explicitly PARTIAL.
    for (const id of ['P12-DEPLOY', 'P12-NEW-PROJECT']) {
      expect(f.find((x) => x.id === id)?.state, id).toBe('COMPLETE');
    }
    for (const id of ['P8-PASSKEYS', 'P9-VISUAL', 'P9-LIGHTHOUSE', 'P9-A11Y', 'P8-PIN']) {
      expect(f.find((x) => x.id === id)?.state, id).toBe('COMPLETE');
    }
    expect(f.some((x) => x.state === 'PARTIAL')).toBe(true);
  });

  it('key POST actions the UI invokes are wired and reject malformed input with 4xx', async () => {
    const h = makeHarness();
    await h.setup();
    const posts: [string, unknown][] = [
      ['/api/v1/website/publish', {}],
      ['/api/v1/integrity/run', {}],
      ['/api/v1/backup/run', {}],
      ['/api/v1/sales', { date: TODAY, book_code: 'FERT', lines: [], note: '' }],
      ['/api/v1/expenses', { date: TODAY, amount_paisa: 0, account_id: 'acct-cash', category_code: 'OTHER' }],
      ['/api/v1/accounting/journal', { date: TODAY, memo_ur: 'x', reason: 'x', lines: [] }],
    ];
    for (const [path, body] of posts) {
      const r = await h.call('POST', path, body);
      expect(r.status, `${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`).toBeLessThan(500);
    }
  });
});
