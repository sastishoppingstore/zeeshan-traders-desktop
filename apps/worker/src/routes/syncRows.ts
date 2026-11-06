/**
 * Row-tier sync endpoints for the offline desktop app.
 *
 *   POST /api/v1/sync/rows/push   batch of {op_id, entity, id, data, base_version, deleted}
 *   GET  /api/v1/sync/pull        ?entity=a,b&since=<cursor>&limit=<n>
 *
 * Deliberate choices:
 *  - Table and column identifiers come ONLY from the registry in @zt/shared, never from the body.
 *    Client values are always bound. `sqlId()` is a belt-and-braces assertion on top of that.
 *  - A push is not one big transaction. Each record is guarded by a conditional
 *    `UPDATE ... WHERE pk=? AND version=:base_version` — the same optimistic lock the web app's PUT
 *    endpoints already use. If a racing writer bumps the version, our update matches zero rows and
 *    the record is reported as a conflict instead of silently clobbering the other edit. Records
 *    therefore succeed or fail independently, so one bad row never rolls back good work.
 *  - `op_id` makes a retry idempotent. Without it, a push whose response was lost would come back
 *    with a now-stale base_version and be discarded as a conflict.
 *  - The server owns version, updated_at and deleted. Client timestamps are never read.
 *  - Reads use `.all()` and writes use one `db.batch()`, because db.batch() reports only
 *    `{changes}` on both adapters — it cannot return row data.
 */
import type { Hono } from 'hono';
import type { AppContext, AppEnv, AppVars } from '../context.js';
import { BizError, audit, handle, me, nowIso, ok, rateLimit } from '../context.js';
import type { DB } from '../db.js';
import type { SessionUser } from '@zt/shared';
import {
  REPLICA_ENTITIES, ROW_ENTITIES, entityOf, rowEntity, sanitizeRowData,
  type PushRowOp, type PushRowResult, type ReplicaEntity, type RowEntity,
} from '@zt/shared';
import { uniqueSlugForTable } from '../services/common.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

const MAX_BATCH = 200;
const MAX_PAGE = 2000;
const DEFAULT_PAGE = 500;
const EPOCH = '1970-01-01T00:00:00.000Z';

/** Registry names are already safe; this keeps a bad edit loud instead of turning it into SQL. */
function sqlId(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new BizError(500, 'REGISTRY_INVALID', 'اندرونی خرابی', `Unsafe identifier in sync registry: ${name}`);
  }
  return name;
}

const hasPerm = (user: SessionUser, perm: string) =>
  user.permissions.includes('*') || user.permissions.includes(perm);

interface Current { id: string; version: number; updated_at: string; deleted: number }

export function registerSyncRows(app: H): void {

  app.post('/api/v1/sync/rows/push', (c) => handle(c, async () => {
    const body = (await c.req.json()) as { rows?: PushRowOp[]; device_id?: string };
    return handleRowPush(c, String(body?.device_id ?? ''), Array.isArray(body?.rows) ? body.rows : []);
  }));

  app.get('/api/v1/sync/pull', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const user = me(c);
    if (!hasPerm(user, 'sync.read')) throw new BizError(403, 'PERMISSION_DENIED', 'سنک کی اجازت نہیں', 'Missing sync.read');
    if (!(await rateLimit(db, `syncpull:${user.id}`, 240, 60_000))) {
      throw new BizError(429, 'RATE_LIMITED', 'بہت زیادہ درخواستیں', 'Too many sync requests; slow down');
    }
    const since = c.req.query('since') ?? '';
    if (since && !/^[0-9A-Za-z:T.\-]{1,40}$/.test(since)) {
      throw new BizError(400, 'INVALID_CURSOR', 'کرسر غلط ہے', 'Malformed since cursor');
    }
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(c.req.query('limit') ?? DEFAULT_PAGE) || DEFAULT_PAGE));
    const wanted = (c.req.query('entity') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const device = (c.req.query('device') ?? user.device_id ?? 'unknown').slice(0, 64);

    const scope = (wanted.length
      ? wanted.map((name) => entityOf(name)).filter((e): e is RowEntity | ReplicaEntity => !!e && e.tier !== 'command')
      : [...ROW_ENTITIES, ...REPLICA_ENTITIES]
    ).filter((def) => hasPerm(user, def.readPerm));

    const entities: Record<string, { rows: Record<string, unknown>[]; cursor: string; has_more: boolean }> = {};
    const cursorWrites = [];
    for (const def of scope) {
      const slice = def.tier === 'row' ? await pullRows(db, def, since, limit) : await pullReplica(db, def, since, limit);
      entities[def.entity] = slice;
      if (slice.rows.length) {
        cursorWrites.push(db.prepare(`INSERT INTO sync_device_cursors (device_id,entity,cursor,rows_pulled,updated_at)
          VALUES (?,?,?,?,?) ON CONFLICT(device_id,entity) DO UPDATE SET cursor=excluded.cursor,
            rows_pulled=sync_device_cursors.rows_pulled+excluded.rows_pulled, updated_at=excluded.updated_at`)
          .bind(device, def.entity, slice.cursor, slice.rows.length, nowIso()));
      }
    }
    if (cursorWrites.length) await db.batch(cursorWrites);
    return ok(c, { server_time: nowIso(), entities });
  }));
}

// ------------------------------------------------------------------ PUSH -------

/**
 * Shared by `POST /sync/rows/push` and the batch branch of `POST /sync/push`, so both entry points
 * enforce the same permission, rate limit and batch-size rules.
 */
export async function handleRowPush(c: AppContext, deviceIdArg: string, rows: PushRowOp[]): Promise<Response> {
  const user = me(c);
  if (!hasPerm(user, 'sync.read')) throw new BizError(403, 'PERMISSION_DENIED', 'سنک کی اجازت نہیں', 'Missing sync.read');
  const db = c.get('db')!;
  if (!(await rateLimit(db, `syncpush:${user.id}`, 120, 60_000))) {
    throw new BizError(429, 'RATE_LIMITED', 'بہت زیادہ درخواستیں', 'Too many sync requests; slow down');
  }
  if (rows.length > MAX_BATCH) {
    throw new BizError(413, 'BATCH_TOO_LARGE', `ایک بار میں زیادہ سے زیادہ ${MAX_BATCH} ریکارڈ`, `Max ${MAX_BATCH} rows per push`);
  }
  const deviceId = (deviceIdArg || user.device_id || 'unknown').slice(0, 64);
  return ok(c, await pushRows(db, user, rows, deviceId));
}

interface Usable { op: PushRowOp; def: RowEntity; data: Record<string, string | number | null> }

async function pushRows(db: DB, user: SessionUser, ops: PushRowOp[], deviceId: string): Promise<PushRowResult> {
  const result: PushRowResult = { accepted: [], conflicts: [], failed: [] };

  // 0. Shape-check, then drop anything the client is not allowed to write.
  const usable: Usable[] = [];
  for (const op of ops) {
    const def = rowEntity(String(op?.entity ?? ''));
    if (!def) {
      result.conflicts.push({ id: safeId(op?.id), entity: String(op?.entity ?? ''), reason: 'NOT_PERMITTED',
        message: 'Not a row-syncable entity (financial documents sync as commands; derived tables are pull-only).' });
      continue;
    }
    if (!hasPerm(user, def.writePerm)) {
      result.conflicts.push({ id: safeId(op?.id), entity: op.entity, reason: 'NOT_PERMITTED',
        message: `Missing permission ${def.writePerm}` });
      continue;
    }
    if (typeof op.id !== 'string' || !/^[0-9A-Za-z._:-]{1,64}$/.test(op.id)) {
      result.failed.push({ id: safeId(op?.id), entity: op.entity, code: 'INVALID_ID', message: 'Malformed record id' });
      continue;
    }
    if (typeof op.op_id !== 'string' || !/^[0-9A-Za-z._:-]{1,64}$/.test(op.op_id)) {
      result.failed.push({ id: op.id, entity: op.entity, code: 'INVALID_OP_ID', message: 'op_id is required and must be a plain id' });
      continue;
    }
    if (!Number.isInteger(op.base_version) || op.base_version < 0) {
      result.failed.push({ id: op.id, entity: op.entity, code: 'INVALID_VERSION', message: 'base_version must be a non-negative integer' });
      continue;
    }
    const data = sanitizeRowData(def, op.data);
    const deleted = op.deleted === 1 ? 1 : 0;
    if (!Object.keys(data).length && !deleted) {
      result.failed.push({ id: op.id, entity: op.entity, code: 'EMPTY_ROW', message: 'No writable columns in this record' });
      continue;
    }
    usable.push({ op, def, data: { ...data, deleted } });
  }

  // 1. Already-accepted op_ids are answered from the ledger instead of being applied again.
  const replayed = await lookUpAcceptedOps(db, usable.map((u) => u.op.op_id));
  const fresh: Usable[] = [];
  for (const u of usable) {
    const seen = replayed.get(u.op.op_id);
    if (seen) result.accepted.push({ id: seen.row_id, entity: seen.entity, version: seen.version, updated_at: seen.updated_at });
    else fresh.push(u);
  }
  if (!fresh.length) return result;

  // 2. Read the current version of every touched row — one query per entity.
  const current = new Map<string, Current>();
  const byEntity = new Map<string, Usable[]>();
  for (const u of fresh) {
    const list = byEntity.get(u.def.entity) ?? [];
    list.push(u);
    byEntity.set(u.def.entity, list);
  }
  for (const [, list] of byEntity) {
    const def = list[0].def;
    const ph = list.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT ${sqlId(def.pk)} AS id, version, updated_at, deleted FROM ${sqlId(def.table)} WHERE ${sqlId(def.pk)} IN (${ph})`)
      .bind(...list.map((u) => u.op.id)).all<Current>();
    for (const r of rows) current.set(`${def.entity}:${r.id}`, r);
  }

  // 3. Plan the writes, skipping rows whose base_version no longer matches.
  const at = nowIso();
  const writes = [];
  const plan: { op: PushRowOp; def: RowEntity; insert: boolean }[] = [];
  for (const { op, def, data } of fresh) {
    const cur = current.get(`${def.entity}:${op.id}`);
    const table = sqlId(def.table);
    const pk = sqlId(def.pk);

    if (!cur) {
      // A create must carry every NOT-NULL-without-default column. Checked here rather than left
      // to SQLite because a raised constraint would roll the whole batch back on both adapters.
      const missing = def.required.filter((col) => data[col] === undefined || data[col] === null);
      if (missing.length) {
        result.failed.push({ id: op.id, entity: op.entity, code: 'MISSING_REQUIRED',
          message: `Required column(s) for a new ${def.entity}: ${missing.join(', ')}` });
        continue;
      }
      // A slug is server-owned: it is never in `def.columns`, so the client cannot send one. Entities
      // that need it (products, categories) declare `derive_slug`, and the create must generate it the
      // same way the online POST handler does — otherwise every product added at the counter offline
      // would fail with "NOT NULL constraint failed: products.slug".
      const extra: Record<string, string> = {};
      if (def.derive_slug) {
        const source = String(data.name_ur ?? data.name_en ?? data.code ?? def.entity);
        extra.slug = await uniqueSlugForTable(db, sqlId(def.table), source, op.id);
      }
      const cols = [pk, ...Object.keys(data).map(sqlId), ...Object.keys(extra).map(sqlId), 'version', 'updated_at'];
      const vals: unknown[] = [op.id, ...Object.values(data), ...Object.values(extra), 1, at];
      if (def.has_created_at) { cols.push('created_at'); vals.push(at); }
      if (def.has_created_by) { cols.push('created_by'); vals.push(user.id); }
      // ON CONFLICT DO NOTHING: a concurrent insert of the same id loses cleanly (changes === 0)
      // instead of raising and failing every other row in the batch.
      writes.push(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT (${pk}) DO NOTHING`)
        .bind(...vals));
      plan.push({ op, def, insert: true });
      continue;
    }
    if (cur.version !== op.base_version) {
      result.conflicts.push({
        id: op.id, entity: op.entity, reason: 'VERSION',
        server: { id: op.id, version: cur.version, updated_at: cur.updated_at, deleted: cur.deleted },
        message: `Server is at version ${cur.version}; client pushed against base_version ${op.base_version}.`,
      });
      continue;
    }
    const setCols = Object.keys(data).map(sqlId);
    writes.push(db.prepare(
      `UPDATE ${table} SET ${setCols.map((x) => `${x}=?`).join(',')}, version=version+1, updated_at=?
       WHERE ${pk}=? AND version=?`)
      .bind(...Object.values(data), at, op.id, op.base_version));
    plan.push({ op, def, insert: false });
  }

  if (!writes.length) return result;

  // 4. Apply, then record the verdicts so a retry of this batch is a no-op.
  // `db.batch()` is one implicit transaction on both adapters, so a single statement that raises
  // (an unforeseen constraint, a FK we did not predict) would otherwise discard every good record
  // beside it. On that rare path the same statements are re-applied one at a time, which keeps the
  // promise the desktop's queue depends on: one bad record never blocks the rest.
  const errors: (string | null)[] = plan.map(() => null);
  let outcomes: { changes: number }[];
  try {
    outcomes = await db.batch(writes);
  } catch {
    outcomes = [];
    for (let i = 0; i < writes.length; i++) {
      const q = writes[i];
      try {
        const one = await db.batch([db.prepare(q.sql).bind(...q.args)]);
        outcomes.push(one[0] ?? { changes: 0 });
      } catch (e) {
        outcomes.push({ changes: 0 });
        errors[i] = e instanceof Error ? e.message : String(e);
      }
    }
  }
  const acceptedForLedger: { op_id: string; entity: string; row_id: string; version: number }[] = [];
  for (let i = 0; i < plan.length; i++) {
    const { op, def, insert } = plan[i];
    const changes = Number(outcomes[i]?.changes ?? 0);
    if (changes !== 1) {
      if (errors[i]) {
        result.failed.push({ id: op.id, entity: op.entity, code: 'REJECTED', message: errors[i]! });
        continue;
      }
      result.conflicts.push({ id: op.id, entity: op.entity, reason: 'VERSION',
        message: insert
          ? 'A record with this id appeared on the server while the batch was applying.'
          : 'Version moved on while this batch was applying.' });
      continue;
    }
    const version = insert ? 1 : op.base_version + 1;
    result.accepted.push({ id: op.id, entity: op.entity, version, updated_at: at });
    acceptedForLedger.push({ op_id: op.op_id, entity: def.entity, row_id: op.id, version });
  }
  if (acceptedForLedger.length) {
    await db.batch(acceptedForLedger.map((e) => db.prepare(
      `INSERT INTO sync_row_ops (op_id,device_id,entity,row_id,verdict,version,updated_at)
       VALUES (?,?,?,?, 'ACCEPTED', ?, ?) ON CONFLICT (op_id) DO NOTHING`)
      .bind(e.op_id, deviceId, e.entity, e.row_id, e.version, at)));
  }
  return result;
}

const safeId = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : '');

async function lookUpAcceptedOps(db: DB, opIds: string[]): Promise<Map<string, { entity: string; row_id: string; version: number; updated_at: string }>> {
  const found = new Map<string, { entity: string; row_id: string; version: number; updated_at: string }>();
  const ids = opIds.filter((x) => typeof x === 'string' && x);
  if (!ids.length) return found;
  // Chunked to stay well inside SQLite's parameter limit (default 999, D1 similar).
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await db.prepare(
      `SELECT op_id, entity, row_id, version, updated_at FROM sync_row_ops WHERE op_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk).all<{ op_id: string; entity: string; row_id: string; version: number; updated_at: string }>();
    for (const r of rows) found.set(r.op_id, r);
  }
  return found;
}

// ------------------------------------------------------------------- PULL ------

async function pullRows(db: DB, def: RowEntity, since: string, limit: number) {
  const table = sqlId(def.table);
  const rows = since
    ? await db.prepare(`SELECT * FROM ${table} WHERE updated_at > ? ORDER BY updated_at LIMIT ?`).bind(since, limit).all<Record<string, unknown>>()
    : await db.prepare(`SELECT * FROM ${table} ORDER BY updated_at LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  const last = rows[rows.length - 1];
  return { rows, cursor: since && !last ? since : String(last?.updated_at ?? since ?? EPOCH), has_more: rows.length === limit };
}

async function pullReplica(db: DB, def: ReplicaEntity, since: string, limit: number) {
  const table = sqlId(def.table);
  const cursor = sqlId(def.cursor);
  const order = (def.pk_cols ?? [def.pk]).map(sqlId).join(',');
  if (def.full_refresh) {
    // Recomputed in place on the server and never client-writable, so re-sending the whole small
    // table is always correct and cheaper than tracking per-row history.
    const rows = await db.prepare(`SELECT * FROM ${table} ORDER BY ${order} LIMIT ?`).bind(limit).all<Record<string, unknown>>();
    return { rows, cursor: '', has_more: rows.length === limit };
  }
  const rows = since
    ? await db.prepare(`SELECT * FROM ${table} WHERE ${cursor} > ? ORDER BY ${cursor} LIMIT ?`).bind(since, limit).all<Record<string, unknown>>()
    : await db.prepare(`SELECT * FROM ${table} ORDER BY ${cursor} LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
  return { rows, cursor: String(last?.[cursor] ?? since ?? EPOCH), has_more: rows.length === limit };
}
