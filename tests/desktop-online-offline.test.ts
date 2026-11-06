/**
 * The seam: `electron/sync.cjs` + `electron/rest-serve.cjs` driven against the REAL Worker app.
 *
 * `tests/sync.test.ts` proves the server half and `tests/desktop-local-sync.test.ts` proves the
 * local store in isolation. Neither exercises the actual push/pull loop a shop counter runs — the
 * one place where a shape drift between the two halves (a payload key, a verdict field, a cursor)
 * would only ever show up on a real machine, offline. This file closes that gap: it opens the real
 * local SQLite store, wires the real sync engine to the real Hono app over a fetch shim, and makes
 * assertions about a shop's day (save offline, push, pull a web edit, lose a race, delete).
 *
 * Runs on the node:sqlite fallback — no Electron, no better-sqlite3, no window.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness } from './helpers.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { openLocalDb } = require(`${ROOT}electron/db.cjs`);
const { createSyncEngine } = require(`${ROOT}electron/sync.cjs`);
const { createRestServe } = require(`${ROOT}electron/rest-serve.cjs`);

const BASE = 'https://zt.test';

interface Desktop { store: any; engine: any; rest: any; logs: Array<[string, unknown]>; close(): void }

/** The engine only reads `ok`, `status` and `text()`; the harness already parsed the body. */
const asResponse = (res: { status: number; json: any }) => ({
  ok: res.status >= 200 && res.status < 300,
  status: res.status,
  text: async () => JSON.stringify(res.json),
}) as any;

/**
 * One desktop: a real local database, the real sync engine pointed at the harness Worker, and the
 * real local REST router. `http.reachable()` is always true and `forward` hits the Worker, which is
 * exactly what the app does with a live line; the offline behaviour is exercised by not running the
 * engine in between.
 */
function makeDesktop(h: Harness): Desktop {
  const store = openLocalDb({ file: ':memory:', appRoot: ROOT });
  const logs: Array<[string, unknown]> = [];
  const log = (m: string, e?: unknown) => { logs.push([m, e]); };

  const engine = createSyncEngine({
    cfg: {
      apiBaseUrl: BASE, apiBaseError: null, requestTimeoutMs: 20_000, probeTimeoutMs: 5_000,
      rowPushBatch: 150, commandPushBatch: 40, pullLimit: 500, pullEntitiesPerRequest: 10,
      syncIntervalMs: 30_000, saveDebounceMs: 4_000, log: false,
    },
    store,
    log,
    getToken: async () => h.token(),
    fetchImpl: async (url: string, init: any = {}) => {
      const u = new URL(url);
      const method = String(init.method ?? 'GET').toUpperCase();
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      const authed = !u.pathname.endsWith('/health');
      return asResponse(await h.call(method, u.pathname + u.search, body, { bearer: authed }));
    },
  });

  const rest = createRestServe({
    store,
    log,
    http: {
      reachable: () => true,
      forward: async (method: string, url: string, body: unknown) => {
        const u = new URL(BASE + url);
        const res = await h.call(String(method).toUpperCase(), u.pathname + u.search, body, { bearer: true });
        const json = res.json as any;
        if (json && typeof json === 'object' && 'ok' in json) {
          return json.ok
            ? { ok: true, status: res.status, data: json.data }
            : { ok: false, status: res.status, error: json.error };
        }
        return { ok: res.status < 300, status: res.status, data: json };
      },
    },
  });

  return { store, engine, rest, logs, close: () => store.close() };
}

const PRODUCT = (over: Record<string, unknown> = {}) => ({
  name_ur: 'ایندھن', name_en: 'Offline Product', category_id: 'cat-fert',
  base_unit: 'bag', purchase_unit: 'bag', sale_unit: 'bag',
  conversion_ratio_milli: 1000, grams_per_base_unit: 50_000,
  purchase_rate_paisa: 100, sale_rate_paisa: 200, reorder_level_milli: 0,
  is_active: 1, is_published: 0, show_public_price: 0, ...over,
});

describe('desktop online/offline loop against the real Worker', () => {
  let h: Harness;
  const opened: Desktop[] = [];
  beforeAll(async () => { h = makeHarness(); await h.setup(); });
  afterEach(() => { while (opened.length) { try { opened.pop()!.close(); } catch { /* closed */ } } });
  const desktop = () => { const d = makeDesktop(h); opened.push(d); return d; };

  it('saves offline, pushes on the next run, and brings the local row onto the server version', async () => {
    const d = desktop();
    const saved = await d.rest.handle('POST', '/api/v1/products', PRODUCT());
    expect(saved.ok).toBe(true);
    expect(saved.status).toBe(201);
    const id = saved.data.id as string;
    expect(id).toBeTruthy();
    expect(d.store.pendingCount()).toBe(1);
    expect(d.store.get('products', id).synced).toBe(0);
    expect(d.store.get('products', id).version).toBe(0);   // never seen by the server yet

    const run = await d.engine.runOnce('manual');
    expect(run.pushed_rows.accepted).toBe(1);

    const server = await h.call('GET', `/api/v1/products/${id}`);
    expect(server.status).toBe(200);
    expect(server.json.data.name_en).toBe('Offline Product');
    expect(server.json.data.version).toBe(1);

    // The local copy now carries the server's version, so the next edit bases on the right number.
    expect(d.store.get('products', id).synced).toBe(1);
    expect(d.store.get('products', id).version).toBe(1);
    expect(d.store.pendingCount()).toBe(0);
  });

  it('answers a read from the local mirror while offline and forwards nothing', async () => {
    const d = desktop();
    // A previous online session is what populated the mirror; do one to be faithful.
    await d.engine.runOnce('manual');
    const offlineRead = await d.rest.handle('GET', '/api/v1/products', undefined);
    expect(offlineRead.ok).toBe(true);
    expect(Array.isArray(offlineRead.data.rows)).toBe(true);
    // No forwarded call happened: the harness Worker never saw a products list request from the read.
    expect(d.logs.some(([m]) => /fell back to the API/i.test(String(m)))).toBe(false);
  });

  it('brings a web edit down on the next pull', async () => {
    const d = desktop();
    const saved = await d.rest.handle('POST', '/api/v1/products', PRODUCT({ name_en: 'Before Web Edit' }));
    const id = saved.data.id as string;
    await d.engine.runOnce('manual');
    expect(d.store.get('products', id).name_en).toBe('Before Web Edit');

    const web = await h.call('PUT', `/api/v1/products/${id}`, { name_en: 'After Web Edit' });
    expect(web.status).toBe(200);

    await d.engine.runOnce('manual');
    const local = d.store.get('products', id);
    expect(local.name_en).toBe('After Web Edit');
    expect(local.version).toBe(2);
    expect(local.synced).toBe(1);
  });

  it('parks a losing offline edit, keeps the server copy, and resolves it', async () => {
    const d = desktop();
    const saved = await d.rest.handle('POST', '/api/v1/products', PRODUCT({ name_en: 'Conflict Base' }));
    const id = saved.data.id as string;
    await d.engine.runOnce('manual');                 // both sides agree at v1

    // The web wins the race first.
    await h.call('PUT', `/api/v1/products/${id}`, { name_en: 'Web Won' });

    // The desktop edits the copy it still holds (base_version 1).
    const mine = d.store.get('products', id);
    const edit = d.store.save('products', { id, name_en: 'Desktop Lost', base_version: mine.version });
    expect(edit.ok).toBe(true);

    await d.engine.runOnce('manual');

    // Nothing was clobbered and nothing was dropped.
    const server = await h.call('GET', `/api/v1/products/${id}`);
    expect(server.json.data.name_en).toBe('Web Won');
    const conflicts = d.store.conflicts.list();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entity).toBe('products');
    expect(conflicts[0].server.name_en).toBe('Web Won');
    expect(conflicts[0].local.name_en).toBe('Desktop Lost');

    // The operator chooses the server copy; the next pull makes the mirror authoritative.
    const resolved = d.store.conflicts.resolve(conflicts[0].id, 'keep_server');
    expect(resolved.ok).toBe(true);
    await d.engine.runOnce('manual');
    expect(d.store.get('products', id).name_en).toBe('Web Won');
    expect(d.store.conflicts.openCount()).toBe(0);
  });

  it('soft-deletes offline and syncs the tombstone, never a hard delete', async () => {
    const d = desktop();
    const created = await d.rest.handle('POST', '/api/v1/payment-methods', { kind: 'CASH', title_ur: 'نقدی', is_active: 1 });
    expect(created.ok).toBe(true);
    const id = created.data.id as string;
    await d.engine.runOnce('manual');
    expect((await h.call('GET', '/api/v1/payment-methods')).json.data.some((m: any) => m.id === id)).toBe(true);

    const del = await d.rest.handle('DELETE', `/api/v1/payment-methods/${id}`);
    expect(del.ok).toBe(true);
    expect(del.data.deleted).toBe(1);
    // Gone from the local list immediately, but still physically present as a tombstone.
    expect(d.store.get('payment_methods', id).deleted).toBe(1);

    await d.engine.runOnce('manual');
    const raw = h.sqlite.prepare('SELECT deleted, version FROM payment_methods WHERE id=?').get(id) as any;
    expect(raw.deleted).toBe(1);
    expect(raw.version).toBe(2);
    expect(d.store.pendingCount()).toBe(0);
  });

  it('queues a financial document offline and posts it through the server engine', async () => {
    const d = desktop();
    const queued = await d.rest.handle('POST', '/api/v1/expenses', {
      date: '2026-11-04', category_code: 'RENT', amount_paisa: 50_000, account_id: 'CASH',
    });
    expect(queued.ok).toBe(true);
    expect(queued.status).toBe(202);
    expect(queued.data.queued).toBe(true);
    expect(d.store.pendingCount()).toBe(1);
    // The desktop never invents an expense row — the queue only holds the intent.
    expect(d.store.get('expenses', 'anything')).toBe(null);

    const run = await d.engine.runOnce('manual');
    expect(run.pushed_commands.accepted).toBe(1);
    expect(d.store.pendingCount()).toBe(0);

    // The server posted it: the expense now exists on the server and came back down the pull.
    const onServer = h.sqlite.prepare('SELECT number, amount_paisa, status FROM expenses WHERE amount_paisa=?').get(50_000) as any;
    expect(onServer.status).toBe('POSTED');
    expect(String(onServer.number)).toMatch(/^EX-/);
    const localDoc = d.store.list('expenses', { limit: 10 }).rows.find((r: any) => r.amount_paisa === 50_000);
    expect(localDoc).toBeTruthy();
  });
});
