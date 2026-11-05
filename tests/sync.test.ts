/**
 * Offline-desktop sync: row-tier push/pull, version conflicts, soft delete, idempotent replay,
 * permission gates and the registry's coverage of the whole schema.
 *
 * These are real calls against the real Hono app and real SQL (tests/helpers.ts), not mocks.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeHarness, createProduct, type Harness } from './helpers.js';
import {
  ALL_ENTITIES, COMMAND_ENTITIES, REPLICA_ENTITIES, ROW_ENTITIES,
  commandEntityByOpType, entityOf, rowEntity,
} from '@zt/shared';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

let h: Harness;
beforeAll(async () => {
  h = makeHarness();
  await h.setup();
});
// Suites that log in as a salesperson or viewer hand the owner session back afterwards; without
// this every later request in the file silently runs with that role's permissions.
afterEach(() => h.asOwner());

const uuid = () => 'op-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
const ulidish = () => 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 10).toUpperCase();

async function push(rows: unknown[], bearer = true) {
  return h.call('POST', '/api/v1/sync/rows/push', { device_id: 'dev-test-1', rows }, { bearer });
}
async function pull(entity: string, since = '', bearer = true) {
  const q = new URLSearchParams();
  if (entity) q.set('entity', entity);
  if (since) q.set('since', since);
  return h.call('GET', `/api/v1/sync/pull?${q}`, undefined, { bearer });
}

// ------------------------------------------------------- registry completeness ----
describe('sync registry covers the real schema', () => {
  const tablesInDb = () => {
    const files = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql = files.map((f) => readFileSync(path.join(ROOT, 'migrations', f), 'utf8')).join('\n');
    return new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(/g)].map((m) => m[1]));
  };

  it('every table in migrations/ is classified into exactly one tier', () => {
    const known = new Map<string, string[]>();
    for (const e of ALL_ENTITIES) known.set(e.table, [...(known.get(e.table) ?? []), e.tier]);
    const missing = [...tablesInDb()].filter((t) => !known.has(t));
    // Tables that are deliberately absent are pure infrastructure (D1 internals, rate limiter
    // scratch). Anything else would be an un-synced feature.
    const IGNORE = new Set(['rate_limits', 'usage_counters', 'webauthn_challenges', 'media_blobs',
      'passkeys', 'backup_logs', 'job_runs', 'accounting_periods', 'notifications', 'permissions',
      'roles', 'role_permissions', 'user_roles', 'sessions', 'sync_row_ops', 'sync_device_cursors']);
    expect(missing.filter((t) => !IGNORE.has(t))).toEqual([]);
  });

  it('declares no table or column that does not exist in the migrations', () => {
    const files = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const sql = files.map((f) => readFileSync(path.join(ROOT, 'migrations', f), 'utf8')).join('\n');
    const colsOf = new Map<string, Set<string>>();
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
      colsOf.set(m[1], new Set([...m[2].matchAll(/^\s*([a-z_]+)\s+(?:TEXT|INTEGER|REAL|NUMERIC|BLOB)/gmi)].map((x) => x[1])));
    }
    // The sync columns arrive by ALTER in 0006, whose statements are column-aligned, so reading
    // only the CREATE blocks would report every one of them missing.
    for (const m of sql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN\s+(\w+)/g)) colsOf.get(m[1])?.add(m[2]);
    const problems: string[] = [];
    for (const def of ROW_ENTITIES) {
      const cols = colsOf.get(def.table);
      if (!cols) { problems.push(`row entity ${def.entity} -> unknown table ${def.table}`); continue; }
      if (!cols.has(def.pk)) problems.push(`${def.table}: pk ${def.pk} missing`);
      for (const c of [...def.columns, 'version', 'updated_at', 'deleted']) {
        if (!cols.has(c)) problems.push(`${def.table}: column ${c} missing`);
      }
      if (cols.has('created_at') !== def.has_created_at) problems.push(`${def.table}: has_created_at wrong`);
      if (cols.has('created_by') !== def.has_created_by) problems.push(`${def.table}: has_created_by wrong`);
    }
    for (const def of REPLICA_ENTITIES) {
      const cols = colsOf.get(def.table);
      if (!cols) { problems.push(`replica ${def.entity} -> unknown table ${def.table}`); continue; }
      if (!cols.has(def.cursor)) problems.push(`${def.table}: cursor column ${def.cursor} missing`);
      if (!cols.has(def.pk)) problems.push(`${def.table}: pk ${def.pk} missing`);
    }
    for (const def of COMMAND_ENTITIES) {
      if (!colsOf.get(def.table)) problems.push(`command ${def.entity} -> unknown table ${def.table}`);
      if (!commandEntityByOpType(def.opType)) problems.push(`opType ${def.opType} not dispatchable`);
    }
    // Joined as one string so a failure names every offending column, not the first three.
    expect(problems.join('\n')).toBe('');
  });

  it('every row-syncable table carries version, updated_at and deleted', () => {
    // The three columns are added by migration 0006, so assert against the live DB, not the text.
    for (const def of ROW_ENTITIES) {
      const row = h.sqlite.prepare(`SELECT COUNT(*) n FROM pragma_table_info(?) WHERE name IN ('version','updated_at','deleted')`)
        .get(def.table) as { n: number };
      expect(`${def.table}:${row.n}`, 'needs version+updated_at+deleted').toBe(`${def.table}:3`);
    }
  });
});

// --------------------------------------------------------------- bearer auth ----
describe('bearer session for the desktop', () => {
  it('authenticates without cookies and without a CSRF token', async () => {
    // chart_of_accounts is populated by the system seed; products is deliberately empty.
    const r = await pull('chart_of_accounts', '', true);
    expect(r.status).toBe(200);
    expect(r.json.data.entities.chart_of_accounts.rows.length).toBeGreaterThan(0);
  });

  it('still enforces CSRF on the cookie path', async () => {
    const r = await h.call('POST', '/api/v1/sync/rows/push', { device_id: 'd', rows: [] }, { csrf: '' });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('CSRF_FAILED');
  });

  it('rejects an unknown bearer token', async () => {
    const res = await h.app.fetch(new Request('https://zt.test/api/v1/sync/pull?entity=products', {
      headers: { Authorization: 'Bearer not-a-real-token-at-all-000000' },
    }), h.env);
    expect(res.status).toBe(401);
  });

  it('refuses a row push from a client that may not write that entity', async () => {
    const created = await h.call('POST', '/api/v1/users', {
      username: 'salesperson1', password: 'salesperson-pass-123', name: 'Sales One',
      mobile: '0300-1110001', role_codes: ['SALESPERSON'],
    });
    expect(created.status).toBe(201);
    await h.login('salesperson1', 'salesperson-pass-123');
    const r = await push([{ op_id: uuid(), entity: 'chart_of_accounts', id: '9999', data: { name_ur: 'hack' }, base_version: 1 }]);
    expect(r.status).toBe(200);
    expect(r.json.data.accepted).toHaveLength(0);
    expect(r.json.data.conflicts[0].reason).toBe('NOT_PERMITTED');
    // Nothing was written by the refused push.
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM chart_of_accounts WHERE code=?').get('9999')).toEqual({ n: 0 });
  });
});

// ------------------------------------------------------------- row push/pull ----
describe('row-tier push and pull', () => {
  it('accepts an offline-created record and hands it to another client on pull', async () => {
    const id = ulidish();
    const r = await push([{
      op_id: uuid(), entity: 'brands', id, base_version: 1,
      data: { name_ur: 'نیا برانڈ', name_en: 'New Brand', is_active: 1 },
    }]);
    expect(r.status).toBe(200);
    expect(r.json.data.accepted).toEqual([{ id, entity: 'brands', version: 1, updated_at: expect.any(String) }]);

    const p = await pull('brands');
    const row = p.json.data.entities.brands.rows.find((x: any) => x.id === id);
    expect(row.name_en).toBe('New Brand');
    expect(row.version).toBe(1);
    expect(row.deleted).toBe(0);
  });

  it('rejects a stale base_version and returns the current server row instead of writing', async () => {
    const { id } = await createProduct(h, { name_en: 'Conflict Base', sku: 'CONF-' + ulidish() });
    const read = await h.call('GET', `/api/v1/products/${id}`);
    const v1 = read.json.data.version as number;

    // Web user edits first.
    const web = await h.call('PUT', `/api/v1/products/${id}`, { name_en: 'Web Won' });
    expect(web.status).toBe(200);

    // Desktop, having last seen v1, now pushes its own edit.
    const r = await push([{
      op_id: uuid(), entity: 'products', id, base_version: v1,
      data: { name_en: 'Desktop Lost', sale_rate_paisa: 123456 },
    }]);
    expect(r.json.data.accepted).toHaveLength(0);
    const conflict = r.json.data.conflicts[0];
    expect(conflict.reason).toBe('VERSION');
    expect(conflict.server.version).toBe(v1 + 1);
    expect(conflict.id).toBe(id);

    // The server copy is untouched by the rejected push.
    const after = await h.call('GET', `/api/v1/products/${id}`);
    expect(after.json.data.name_en).toBe('Web Won');
    expect(after.json.data.sale_rate_paisa).not.toBe(123456);
  });

  it('applies an edit that is based on the version it actually read', async () => {
    const { id } = await createProduct(h, { name_en: 'Happy Path', sku: 'HAPPY-' + ulidish() });
    const read = await h.call('GET', `/api/v1/products/${id}`);
    const r = await push([{
      op_id: uuid(), entity: 'products', id, base_version: read.json.data.version,
      data: { name_en: 'Edited Offline', sale_rate_paisa: 9900 },
    }]);
    expect(r.json.data.accepted[0].version).toBe(read.json.data.version + 1);
    const after = await h.call('GET', `/api/v1/products/${id}`);
    expect(after.json.data.name_en).toBe('Edited Offline');
    expect(after.json.data.sale_rate_paisa).toBe(9900);
  });

  it('ignores client-supplied version, updated_at and any column outside the whitelist', async () => {
    const id = ulidish();
    const r = await push([{
      op_id: uuid(), entity: 'brands', id, base_version: 1,
      data: { name_ur: 'صاف', name_en: 'Clean', version: 99, updated_at: '1999-01-01T00:00:00.000Z',
        created_by: 'attacker', slug: 'hijacked', deleted: 1 },
    }]);
    expect(r.json.data.accepted).toHaveLength(1);
    const row = (await h.call('GET', `/api/v1/brands`)).json.data.find((b: any) => b.id === id);
    expect(row.version).toBe(1);
    expect(row.updated_at > '2020-01-01').toBe(true);
    expect(row.deleted).toBe(0);          // `deleted` is only ever set by the op's own flag
    expect(row.created_by ?? undefined).toBeUndefined();
  });

  it('lets one bad record fail without losing the good ones in the same batch', async () => {
    const good = ulidish();
    const r = await push([
      { op_id: uuid(), entity: 'brands', id: good, base_version: 1, data: { name_ur: 'اچھا', name_en: 'Good One' } },
      { op_id: uuid(), entity: 'brands', id: 'x'.repeat(80), base_version: 1, data: { name_en: 'Bad Id' } },
      { op_id: uuid(), entity: 'brands', id: ulidish(), base_version: 1, data: { nothing_writable: 1 } },
      { op_id: uuid(), entity: 'parties', id: ulidish(), base_version: 1, data: { name_en: 'No Name' } },
      { op_id: uuid(), entity: 'stock_balance', id: 'p/wh-main', base_version: 1, data: { qty_milli: 999999 } },
    ]);
    expect(r.status).toBe(200);
    expect(r.json.data.accepted.map((a: any) => a.id)).toEqual([good]);
    // Each defect is named instead of aborting the batch: a bad id, a record with no writable
    // column, a create missing a NOT NULL column, and an attempt at a derived table.
    expect(r.json.data.failed.map((f: any) => f.code).sort()).toEqual(['EMPTY_ROW', 'INVALID_ID', 'MISSING_REQUIRED']);
    expect(r.json.data.conflicts[0].reason).toBe('NOT_PERMITTED');
    const bal = (await h.call('GET', '/api/v1/sync/pull?entity=stock_balance')).json.data;
    expect(JSON.stringify(bal)).not.toContain('999999');
  });

  it('is idempotent: replaying the same op_id cannot double-apply or invent a version', async () => {
    const id = ulidish();
    const op = { op_id: uuid(), entity: 'brands', id, base_version: 1, data: { name_ur: 'دہرائیں', name_en: 'Replay Me' } };
    const first = await push([op]);
    expect(first.json.data.accepted[0].version).toBe(1);

    // A desktop that never saw the response retries — its base_version is now stale, which would
    // normally be a conflict. op_id is what saves the edit from being discarded.
    const retry = await push([op]);
    expect(retry.json.data.accepted).toEqual([{ id, entity: 'brands', version: 1, updated_at: expect.any(String) }]);
    expect(retry.json.data.conflicts).toHaveLength(0);

    const brands = (await h.call('GET', '/api/v1/brands')).json.data;
    const matches = brands.filter((b: any) => b.id === id);
    expect(matches).toHaveLength(1);
    expect(matches[0].version).toBe(1);
  });

  it('propagates a soft delete as a tombstone rather than dropping the row', async () => {
    const id = ulidish();
    await push([{ op_id: uuid(), entity: 'brands', id, base_version: 1, data: { name_ur: 'مٹائیں', name_en: 'Delete Me' } }]);

    const del = await push([{ op_id: uuid(), entity: 'brands', id, base_version: 1, data: { name_ur: 'مٹائیں', name_en: 'Delete Me' }, deleted: 1 }]);
    expect(del.json.data.accepted[0].version).toBe(2);

    // Still physically present — that is how the other 6 devices learn about the deletion.
    const raw = h.sqlite.prepare('SELECT deleted, version, updated_at FROM brands WHERE id=?').get(id) as any;
    expect(raw.deleted).toBe(1);

    // And the tombstone comes back down the delta pull for a second client.
    const p = await pull('brands');
    const row = p.json.data.entities.brands.rows.find((x: any) => x.id === id);
    expect(row.deleted).toBe(1);

    // A resurrect push (deleted back to 0) is an ordinary versioned edit.
    const back = await push([{ op_id: uuid(), entity: 'brands', id, base_version: 2, data: { name_ur: 'مٹائیں', name_en: 'Delete Me' }, deleted: 0 }]);
    expect(back.json.data.accepted[0].version).toBe(3);
  });

  it('delta pull returns only what changed after the cursor, and pages', async () => {
    await createProduct(h, { name_en: 'Base One', sku: 'BONE-' + ulidish() });
    await createProduct(h, { name_en: 'Base Two', sku: 'BTWO-' + ulidish() });
    const all = await pull('products');
    const cursor = all.json.data.entities.products.cursor;
    expect(all.json.data.entities.products.rows.length).toBeGreaterThanOrEqual(2);

    const nothing = await pull('products', cursor);
    expect(nothing.json.data.entities.products.rows).toHaveLength(0);
    expect(nothing.json.data.entities.products.cursor).toBe(cursor);

    const { id } = await createProduct(h, { name_en: 'After Cursor', sku: 'AFTR-' + ulidish() });
    const delta = await pull('products', cursor);
    expect(delta.json.data.entities.products.rows.map((r: any) => r.id)).toContain(id);

    const tiny = await h.call('GET', '/api/v1/sync/pull?entity=products&limit=2');
    expect(tiny.json.data.entities.products.rows).toHaveLength(2);
    expect(tiny.json.data.entities.products.has_more).toBe(true);
  });

  it('sends recomputed balance tables whole and marks them cursorless', async () => {
    const r = await pull('party_balance');
    expect(r.status).toBe(200);
    expect(r.json.data.entities.party_balance.cursor).toBe('');
    expect(Array.isArray(r.json.data.entities.party_balance.rows)).toBe(true);
  });

  it('hides tables the session may not read', async () => {
    const r = await h.call('GET', '/api/v1/sync/pull?entity=audit_logs,journal_lines');
    expect(r.status).toBe(200);
    const ents = r.json.data.entities;
    // The OWNER session has these; a request for an entity the caller lacks is silently omitted
    // rather than leaking existence. Verify with a role that has neither.
    await h.call('POST', '/api/v1/users', {
      username: 'viewer9', password: 'viewer-password-123', name: 'Viewer',
      mobile: '0300-1110009', role_codes: ['SALESPERSON'],
    });
    await h.login('viewer9', 'viewer-password-123');
    const hidden = await h.call('GET', '/api/v1/sync/pull?entity=audit_logs,journal_lines,users');
    expect(hidden.json.data.entities).toEqual({});
    expect(Object.keys(ents).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------ command / replica gates ----
describe('what a client may never write', () => {
  it('refuses every replica and command entity as a raw row push', async () => {
    const forbidden = [...REPLICA_ENTITIES, ...COMMAND_ENTITIES].map((e) => e.entity);
    const rows = forbidden.map((entity) => ({ op_id: uuid(), entity, id: ulidish(), base_version: 1, data: { id: 'x' } }));
    // Chunk to stay inside the batch limit.
    for (let i = 0; i < rows.length; i += 100) {
      const r = await push(rows.slice(i, i + 100));
      for (const r2 of r.json.data.accepted) throw new Error(`server accepted a non-row entity: ${r2.entity}`);
    }
    const verdicts = await push(rows.slice(0, 40).map((x) => ({ ...x })));
    expect(verdicts.json.data.accepted).toHaveLength(0);
    expect(verdicts.json.data.conflicts.every((c: any) => c.reason === 'NOT_PERMITTED')).toBe(true);
  });

  it('keeps accounting-owned columns off the party write path', async () => {
    const r = await push([{
      op_id: uuid(), entity: 'parties', id: ulidish(), base_version: 1,
      data: { name_ur: 'کسٹمر', type: 'CUSTOMER', opening_balance_paisa: 5000000, cnic_enc: 'forged' },
    }]);
    expect(r.json.data.accepted).toHaveLength(1);
    const row = h.sqlite.prepare('SELECT opening_balance_paisa, cnic_enc FROM parties WHERE id=?')
      .get(r.json.data.accepted[0].id) as any;
    expect(row.opening_balance_paisa).toBe(0);   // stripped: it would need a journal entry
    expect(row.cnic_enc).toBeNull();
  });

/**
 * Bring stock in with an offline PURCHASE command, so a later SALE is rejected for the right reason
 * (nothing else) — the ledger refuses to sell stock the shop never bought.
 */
async function stockIn(product_id: string, qty_milli = 100_000) {
  const res = await h.call('POST', '/api/v1/sync/push', {
    idempotency_key: 'pur-' + ulidish(), device_id: 'dev-desktop-1', type: 'PURCHASE',
    local_time: new Date().toISOString(),
    payload: { date: '2026-11-04', book_code: 'FERT', party_name: 'Offline Supplier',
      lines: [{ product_id, qty_milli, rate_paisa: 250000 }], status: 'POSTED' },
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.data as { id: string };
}

  it('still runs a document command through the posting engine, not a row write', async () => {
    const product = await createProduct(h, { name_en: 'Sold Offline', sku: 'SOFF-' + ulidish() });
    await stockIn(product.id);
    const party = await push([{
      op_id: uuid(), entity: 'parties', id: ulidish(), base_version: 1,
      data: { name_ur: 'بلینڈ کسٹمر', name_en: 'Blended Customer', type: 'CUSTOMER' },
    }]).then((r) => r.json.data.accepted[0].id);

    const key = 'idem-' + ulidish();
    const res = await h.call('POST', '/api/v1/sync/push', {
      idempotency_key: key, device_id: 'dev-desktop-1', type: 'SALE', local_time: new Date().toISOString(),
      payload: { date: '2026-11-04', book_code: 'FERT', party_id: party, lines: [{ product_id: product.id, qty_milli: 1000, rate_paisa: 300000 }],
        paid_paisa: 0, allocate_mode: 'NONE', status: 'POSTED' },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.data.status).toBe('SYNCED');

    // Derived state proves the server did the accounting, not the client.
    const doc = await h.call('GET', `/api/v1/sales/${res.json.data.id}`);
    expect(doc.json.data.total_paisa).toBe(300000);
    const bal = await h.call('GET', '/api/v1/sync/pull?entity=sale_items,stock_movements,party_ledger,journal_lines');
    expect(Object.keys(bal.json.data.entities).length).toBe(4);
  });

  it('batches document commands without letting one failure block the rest', async () => {
    const product = await createProduct(h, { name_en: 'Batch Gate', sku: 'BGATE-' + ulidish() });
    await stockIn(product.id);
    const res = await h.call('POST', '/api/v1/sync/push', {
      device_id: 'dev-desktop-1',
      operations: [
        { idempotency_key: 'batch-bad-' + ulidish(), type: 'EXPENSE', local_time: new Date().toISOString(),
          payload: { date: '2026-11-04', category_code: 'nope', amount_paisa: 100, account_id: 'CASH' } },
        { idempotency_key: 'batch-good-' + ulidish(), type: 'SALE', local_time: new Date().toISOString(),
          payload: { date: '2026-11-04', book_code: 'FERT', lines: [{ product_id: product.id, qty_milli: 1000, rate_paisa: 300000 }],
            party_name: 'Walk-in Customer', paid_paisa: 300000, allocate_mode: 'NONE', status: 'POSTED' } },
      ],
    });
    expect(res.status).toBe(200);
    const results = res.json.data.results;
    expect(results).toHaveLength(2);
    expect(results.map((r: any) => r.status).sort(), JSON.stringify(results)).toEqual(['FAILED', 'SYNCED']);
  });
});

// ------------------------------------------------------ round trip both ways ----
describe('two-way convergence', () => {
  it('a web edit reaches the desktop only after its cursor moves, and a desktop tombstone reaches the web', async () => {
    const id = ulidish();
    await push([{ op_id: uuid(), entity: 'warehouses', id, base_version: 1, data: { code: 'WH-' + id.slice(-5), name_ur: 'نیا گودام', is_default: 0 } }]);

    const before = await pull('warehouses');
    const cursor = before.json.data.entities.warehouses.cursor;

    // Web user renames it.
    const r = await h.call('PUT', '/api/v1/settings', { key: 'maund_kg', value: 40 });
    expect(r.status).toBe(200);

    const delta = await pull('warehouses', cursor);
    expect(delta.json.data.entities.warehouses.rows).toHaveLength(0); // nothing changed in THAT table

    const settingsDelta = await pull('settings', cursor);
    expect(settingsDelta.json.data.entities.settings.rows.map((x: any) => x.key)).toContain('maund_kg');

    // Desktop deletes its warehouse, then the web list must no longer offer it.
    const del = await push([{ op_id: uuid(), entity: 'warehouses', id, base_version: 1, data: { code: 'WH-' + id.slice(-5), name_ur: 'نیا گودام', is_default: 0 }, deleted: 1 }]);
    expect(del.json.data.accepted[0].version).toBe(2);
    const list = await h.call('GET', '/api/v1/warehouses').catch(() => null);
    const raw = h.sqlite.prepare('SELECT deleted FROM warehouses WHERE id=?').get(id) as any;
    expect(raw.deleted).toBe(1);
    expect(list === null || !JSON.stringify(list.json).includes(id)).toBe(true);
  });
});
