/**
 * The desktop's local SQLite database: schema, reads, and the write path that queues sync.
 *
 * This is the only module that touches better-sqlite3, and the only one that knows the local schema
 * exists. Everything it exposes is expressed in registry entities (`products`, `sales`, …) so the
 * renderer never writes SQL and never learns a column the server has not declared syncable.
 *
 * Three invariants, which are the whole reason offline multi-client editing can be trusted:
 *   1. `synced = 0` means "this local edit has not been accepted by the server yet". An incoming
 *      pull must never overwrite such a row — the local edit wins locally and the server copy is
 *      parked in `local_conflicts` for the user to decide on.
 *   2. `version` / `updated_at` / `deleted` are the server's columns. The desktop only ever writes
 *      them when it is applying a server response. A local save bumps `local_version`, never `version`.
 *   3. Nothing is hard-deleted. `remove()` writes a tombstone, and the tombstone is what tells the
 *      other six devices that the record is gone.
 */
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const registry = require('./registry.cjs');
const { applyServerSchema, readMigrations, schemaFingerprint, tableColumns, tableExists, hasColumn } = require('./migrations.cjs');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_RE = /^[0-9A-Za-z._:-]{1,64}$/;
const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 200;

/** ids.ts ulid(), reimplemented in CommonJS: 10 chars of time + 16 of randomness, Crockford base32. */
function ulid(now = Date.now()) {
  let t = BigInt(now);
  let time = '';
  for (let i = 0; i < 10; i++) { time = CROCKFORD[Number(t % 32n)] + time; t /= 32n; }
  const bytes = crypto.randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] & 31];
  return time + rand;
}

const nowIso = () => new Date().toISOString();
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// ─────────────────────────────────────────────────────── local-only schema ─────
/**
 * Local bookkeeping on top of the mirrored server schema. Split out from `open()` and exported so
 * electron/verify-migrations.cjs can drive it against any SQLite handle.
 */
function buildLocalSchema(db, { log = () => {} } = {}) {
  let added = 0;
  let repaired = 0;

  for (const table of registry.LOCAL_TRACKED_TABLES) {
    if (!tableExists(db, table)) {
      log('tracked table missing from the replayed schema — the desktop will not sync it', { table });
      continue;
    }
    // `synced` = 0 means "pending push". Added to row-tier AND replica tables: replica rows are only
    // ever written by the pull, so they stay 1, but a single rule is easier to trust than two.
    //
    // The default is 1, not 0. SQLite fills existing rows with the column default, and the rows that
    // exist at this moment came from the server's own migrations — a shop's seeded chart of accounts,
    // its 15 categories. Marking those dirty would make the first pull SKIP ~130 rows as "local edits
    // the server must not overwrite" and park each one as a conflict the shop never made. Only `save()`
    // and `remove()` set 0, and both bump `local_version`, so `local_version = 0` identifies a row the
    // desktop has never touched.
    for (const col of ['synced INTEGER NOT NULL DEFAULT 1', 'local_version INTEGER NOT NULL DEFAULT 0']) {
      const name = col.split(' ')[0];
      if (hasColumn(db, table, name)) continue;
      try { db.prepare(`ALTER TABLE ${quoteId(table)} ADD COLUMN ${col}`).run(); added++; }
      catch (e) { log('could not add local column', { table, column: name, error: e.message }); }
    }

    // Databases built before that default was corrected carry server rows as dirty. Repair them the
    // same way the default now prevents it, so an installed desktop stops fighting its own pull.
    if (hasColumn(db, table, 'synced') && hasColumn(db, table, 'local_version')) {
      try {
        const fixed = db.prepare(`UPDATE ${quoteId(table)} SET synced = 1
          WHERE synced = 0 AND local_version = 0`).run().changes;
        if (fixed) repaired += fixed;
      } catch (e) { log('could not repair the local dirty flag', { table, error: e.message }); }
    }
  }
  if (repaired) log('repaired rows that were marked locally edited without ever being edited', { rows: repaired });

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Every local intention, in the order it was made. Rows and document commands share the table
    -- because the sync engine needs one ordered queue to drain, but they are pushed to different
    -- endpoints with different bodies.
    CREATE TABLE IF NOT EXISTS outbox (
      op_id        TEXT PRIMARY KEY,
      entity       TEXT NOT NULL,
      row_id       TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN ('row','command')),
      payload_json TEXT NOT NULL,
      base_version INTEGER NOT NULL DEFAULT 0,
      deleted      INTEGER NOT NULL DEFAULT 0,
      state        TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (state IN ('PENDING','SYNCED','CONFLICT','FAILED')),
      tries        INTEGER NOT NULL DEFAULT 0,
      error        TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox(state, kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_row   ON outbox(entity, row_id, state);

    -- Anything the two sides could not settle automatically. Nothing is ever silently discarded:
    -- a rejected push, an incoming row that would clobber a dirty local row, an orphaned pull row.
    CREATE TABLE IF NOT EXISTS local_conflicts (
      id          TEXT PRIMARY KEY,
      entity      TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      local_data  TEXT,
      server_data TEXT,
      reason      TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conflicts_open
      ON local_conflicts(entity, row_id) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_conflicts_created ON local_conflicts(created_at);
  `);

  return { added_columns: added, repaired_rows: repaired };
}

/** SQLite identifiers are safe if quoted; registry names are already vetted, this is the belt. */
function quoteId(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw err('BAD_IDENTIFIER', `Unsafe SQLite identifier: ${name}`);
  return `"${name}"`;
}

// ─────────────────────────────────────────────────────────── open the store ─────
/**
 * @param {{file: string, appRoot?: string, log?: Function, driver?: Function}} opts
 */
function openLocalDb({ file, appRoot = path.resolve(__dirname, '..'), log = () => {}, driver }) {
  // better-sqlite3 is the production driver; `sqlite-driver.cjs` falls back to node:sqlite so the same
  // code paths can be tested — and do run — on a CI box that has never seen the native build.
  const { db, driver: kind } = driver ? { db: new driver(file), driver: 'injected' } : require('./sqlite-driver.cjs').open(file);
  if (kind !== 'better-sqlite3' && process.env.ELECTRON_RUN_AS_NODE === undefined && file !== ':memory:') {
    log('using the node:sqlite driver — better-sqlite3 is not built for this runtime', { kind });
  }
  db.pragma('journal_mode = WAL');      // reads never block the sync writer
  db.pragma('foreign_keys = ON');       // same enforcement the server has
  db.pragma('busy_timeout = 5000');

  const schema = applyServerSchema(db, { appRoot, log });
  const local = buildLocalSchema(db, { log });
  const fp = schema.fingerprint;
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('schema_version', fp);
  if (schema.failures.length) {
    db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('schema_failures', JSON.stringify(schema.failures).slice(0, 4000));
    log('LOCAL SCHEMA INCOMPLETE — statements the desktop could not replay', { failures: schema.failures.length });
  } else {
    db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('schema_failures', '');
  }

  return createStore({ db, file, log, boot: { schema, local, migrationsSource: schema.source } });
}

/**
 * The store. `db` is injected so the whole write/pull/conflict path is testable without a GUI or a
 * native module (see electron/verify-sync.cjs).
 */
function createStore({ db, file = ':memory:', log = () => {}, boot = {} }) {
  const colCache = new Map();      // table -> [{name, type, notnull, dflt_value, pk}]
  const uniqCache = new Map();     // table -> Set of unique non-pk column names
  const presentCache = new Map();  // table -> boolean
  const warnOnce = new Set();

  // ───────────────────────────────────────────────────────── introspection ─────
  const columnsOf = (table) => {
    if (!colCache.has(table)) colCache.set(table, tableColumns(db, table));
    return colCache.get(table);
  };
  const columnNames = (table) => columnsOf(table).map((c) => c.name);
  const hasTable = (table) => {
    if (!presentCache.has(table)) presentCache.set(table, tableExists(db, table));
    return presentCache.get(table);
  };
  /** Non-PK UNIQUE columns: an offline insert must not invent a duplicate for one of these. */
  function uniqueColumnsOf(table) {
    if (uniqCache.has(table)) return uniqCache.get(table);
    const set = new Set();
    try {
      for (const idx of db.prepare('SELECT * FROM pragma_index_list(?)').all(table)) {
        if (!idx.unique) continue;
        const cols = db.prepare('SELECT name FROM pragma_index_info(?)').all(idx.name).map((r) => r.name);
        if (cols.length === 1) set.add(cols[0]);       // single-column UNIQUE (e.g. products.slug)
      }
    } catch { /* a view of indexes is best-effort; the fallback is a normal insert */ }
    for (const c of columnsOf(table)) if (c.pk) set.delete(c.name);
    uniqCache.set(table, set);
    return set;
  }

  // ────────────────────────────────────────────────────────────────── meta ─────
  const meta = {
    get(key, fallback = null) {
      const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
      return row ? row.value : fallback;
    },
    set(key, value) {
      db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(key, value === null || value === undefined ? null : String(value));
    },
    inc(key) {
      const next = Number(meta.get(key, '0') || '0') + 1;
      meta.set(key, next);
      return next;
    },
    all() {
      const out = {};
      for (const r of db.prepare('SELECT key,value FROM meta').all()) out[r.key] = r.value;
      return out;
    },
  };

  /** Stable per-install identity. Sent as device_id on every push and recorded server-side. */
  function deviceId() {
    let id = meta.get('device_id');
    if (!id || !isId(id)) {
      id = `zt-desktop-${ulid().toLowerCase()}`;
      meta.set('device_id', id);
    }
    return id;
  }

  const cursorKey = (entity) => `last_pull:${entity}`;
  const cursorFor = (entity) => meta.get(cursorKey(entity), '') ?? '';
  function setCursor(entity, cursor) {
    // '' is the server's "no delta cursor exists for this table" marker (full-refresh tables).
    if (cursor === null || cursor === undefined) return;
    meta.set(cursorKey(entity), String(cursor));
  }

  // ───────────────────────────────────────────────────────────── reads ─────
  function definitionForRead(name) {
    const def = registry.readableFor(String(name ?? ''));
    if (!def) throw err('UNKNOWN_ENTITY', `Unknown entity: ${name}`);
    if (!hasTable(def.table)) throw err('TABLE_MISSING', `Local table ${def.table} is missing (see schema_failures)`);
    return def;
  }

  /** Equality filters; a null value becomes IS NULL instead of = NULL. */
  function buildWhere(def, opts, out) {
    const cols = new Set(out.columns);
    const clauses = [];
    const params = [];
    const where = opts.where && typeof opts.where === 'object' ? opts.where : {};
    for (const [raw, value] of Object.entries(where)) {
      const col = String(raw);
      if (!cols.has(col)) throw err('UNKNOWN_COLUMN', `No such column on ${def.table}: ${col}`);
      if (value === null) clauses.push(`${quoteId(col)} IS NULL`);
      else { clauses.push(`${quoteId(col)} = ?`); params.push(bindable(value)); }
    }
    const like = opts.like && typeof opts.like === 'object' ? opts.like : null;
    if (like) {
      for (const [raw, value] of Object.entries(like)) {
        const col = String(raw);
        if (!cols.has(col)) throw err('UNKNOWN_COLUMN', `No such column on ${def.table}: ${col}`);
        clauses.push(`${quoteId(col)} LIKE ? ESCAPE '\\'`);
        params.push(escapeLike(String(value)));
      }
    }
    // The ERP's 2-character product search: any of the named columns matching, case-insensitively.
    if (opts.q) {
      const pool = Array.isArray(opts.qColumns) && opts.qColumns.length ? opts.qColumns : ['name_ur', 'name_en'];
      const or = pool.filter((c) => cols.has(c));
      if (or.length) {
        clauses.push(`(${or.map((c) => `${quoteId(c)} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
        const needle = `%${escapeLike(String(opts.q))}%`;
        for (let i = 0; i < or.length; i++) params.push(needle);
      }
    }
    if (!opts.includeDeleted && cols.has('deleted')) clauses.push('deleted = 0');
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  function buildOrder(def, opts, cols) {
    const fallback = cols.includes('updated_at') ? 'updated_at' : def.pk;
    const wanted = opts.order ?? `-${fallback}`;
    const list = (Array.isArray(wanted) ? wanted : [wanted]).map((spec) => {
      const s = String(spec);
      return s.startsWith('-') ? { col: s.slice(1), dir: 'DESC' } : { col: s, dir: 'ASC' };
    });
    const safe = list.filter((o) => cols.includes(o.col) && (o.dir === 'ASC' || o.dir === 'DESC'));
    const order = safe.length ? safe : [{ col: fallback, dir: 'DESC' }];
    // ULIDs and ISO stamps are both creation-ordered, so a tie is only possible inside one millisecond.
    const tie = cols.includes(def.pk) ? def.pk : order[0].col;
    if (cols.includes(tie) && !order.some((o) => o.col === tie)) order.push({ col: tie, dir: 'ASC' });
    return ` ORDER BY ${order.map((o) => `${quoteId(o.col)} ${o.dir}`).join(', ')}`;
  }

  const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

  /** Opaque page token. An offset is enough here: the local table is a snapshot, not a live cursor. */
  const encodeCursor = (offset) => `v1:${offset}`;
  function decodeCursor(cursor) {
    if (cursor === null || cursor === undefined || cursor === '') return 0;
    const m = /^v1:(\d{1,9})$/.exec(String(cursor));
    if (!m) throw err('BAD_CURSOR', 'Unrecognised cursor');
    return Number(m[1]);
  }

  function list(name, opts = {}) {
    const def = definitionForRead(name);
    const columns = columnNames(def.table);
    if (!hasColumn(db, def.table, 'synced')) columns.push('synced');   // defensive: never expected
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(opts.limit) || DEFAULT_LIMIT));
    const offset = decodeCursor(opts.cursor);
    const { sql: whereSql, params } = buildWhere(def, opts, { columns });
    const orderSql = buildOrder(def, opts, columns);
    const rows = db.prepare(
      `SELECT * FROM ${quoteId(def.table)}${whereSql}${orderSql} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const wantTotal = opts.count !== false;
    const total = wantTotal
      ? db.prepare(`SELECT COUNT(*) n FROM ${quoteId(def.table)}${whereSql}`).get(...params)?.n ?? 0
      : null;
    // Without a COUNT, "more" can only mean "this page was full" — reported honestly as null total.
    const more = total === null ? rows.length === limit : offset + rows.length < total;
    return { rows, cursor: more ? encodeCursor(offset + rows.length) : null, total, more };
  }

  function get(name, id) {
    const def = definitionForRead(name);
    if (!isId(String(id))) throw err('BAD_ID', `Invalid ${name} id`);
    return db.prepare(`SELECT * FROM ${quoteId(def.table)} WHERE ${quoteId(def.pk)} = ?`).get(String(id)) ?? null;
  }

  /** The columns a client is allowed to send for this entity, as they currently sit on the row. */
  function writableSnapshot(def, row) {
    const out = {};
    for (const col of def.columns) if (row && col in row) out[col] = row[col];
    return out;
  }

  // ──────────────────────────────────────────────────── local inserts ─────
  /**
   * The mirrored schema is the server's, so it has NOT NULL columns with no default that a partial
   * offline record cannot know yet (`created_at`, `slug`, …). Instead of weakening the local schema —
   * which would let bad rows through that the server will reject anyway — the desktop fills them with
   * values that are obviously local, and the server's copy replaces them on the next pull.
   */
  function fillRequired(def, data, id, existingRow) {
    const table = def.table;
    const provided = new Set(Object.keys(data));
    if (provided.has(def.pk)) { /* pk already set by caller */ }
    const uniques = uniqueColumnsOf(table);
    const missing = {};
    for (const c of columnsOf(table)) {
      const hasDefault = c.dflt_value !== null && c.dflt_value !== undefined;
      if (!c.notnull || provided.has(c.name) || hasDefault) continue;
      if (c.pk || c.name === 'synced' || c.name === 'local_version') continue;
      if (existingRow && c.name in existingRow) continue;                 // UPDATE path: already stored
      if (c.name === 'created_at' || /_at$/.test(c.name)) { missing[c.name] = nowIso(); continue; }
      if (c.name === 'created_by') { missing[c.name] = meta.get('session_user_id', null) ?? null; continue; }
      const type = String(c.type || '').toUpperCase();
      if (uniques.has(c.name)) { missing[c.name] = `ZTLOCAL-${id}-${c.name}`; continue; }
      if (type.includes('INT')) missing[c.name] = 0;
      else if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) missing[c.name] = 0;
      else if (type.includes('BLOB')) missing[c.name] = Buffer.alloc(0);
      else missing[c.name] = '';
    }
    return missing;
  }

  const bindable = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : typeof v === 'number' || typeof v === 'string' || Buffer.isBuffer(v) || v === null ? v : JSON.stringify(v));

  // ─────────────────────────────────────────────────────── write path ─────
  /**
   * Upsert a master-data record locally and queue it for the server.
   * `{ok:false, conflict:'STALE', local_row}` is returned when the caller's copy is not the current
   * local one — i.e. the row changed (by a pull, or another window) while the form was open. That is
   * the desktop's only chance to stop a lost edit before it is queued, so it refuses instead of
   * guessing; the renderer reloads `local_row` and re-applies.
   */
  function save(name, row) {
    const def = registry.rowEntity(String(name ?? ''));
    if (!def) {
      const other = registry.entityOf(String(name ?? ''));
      if (!other) return { ok: false, error: 'UNKNOWN_ENTITY', message: `Unknown entity: ${name}` };
      return { ok: false, error: `${other.tier.toUpperCase()}_READ_ONLY`,
        message: other.tier === 'command'
          ? `${name} is a document: use command(opType, payload) so the server can post the ledger`
          : `${name} is server-derived: it is pulled, never pushed` };
    }
    if (!hasTable(def.table)) return { ok: false, error: 'TABLE_MISSING', message: `Local table ${def.table} is missing` };

    const raw = row && typeof row === 'object' ? row : null;
    if (!raw) return { ok: false, error: 'BAD_ROW', message: 'save() needs an object' };
    const id = String(raw[def.pk] ?? '').trim();
    if (!isId(id)) {
      if (def.pk !== 'id') return { ok: false, error: 'PK_REQUIRED', message: `${def.table}.${def.pk} must be provided and look like an id` };
      return { ok: false, error: 'BAD_ID', message: `${def.pk} must match /^[0-9A-Za-z._:-]{1,64}$/` };
    }
    const data = registry.sanitizeRowData(def, raw);
    if (!Object.keys(data).length) return { ok: false, error: 'EMPTY_ROW', message: `No writable columns for ${def.entity}` };

    return db.transaction(() => {
      const table = quoteId(def.table);
      const pk = quoteId(def.pk);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(id) ?? null;

      if (existing) {
        const claimed = raw.version ?? raw.base_version;
        if (claimed !== undefined && claimed !== null && Number(claimed) !== Number(existing.version)) {
          return { ok: false, error: 'STALE', conflict: 'STALE', local_row: existing,
            message: `This record changed locally (server version ${existing.version}); reload before saving` };
        }
      }

      const filled = fillRequired(def, data, id, existing);
      const at = nowIso();
      const cols = { ...data, ...filled };
      if (hasColumn(db, def.table, 'updated_at')) cols.updated_at = at;
      if (hasColumn(db, def.table, 'deleted')) cols.deleted = 0;
      if (hasColumn(db, def.table, 'synced')) cols.synced = 0;

      if (existing) {
        const localVersion = Number(existing.local_version ?? 0) + 1;
        if (hasColumn(db, def.table, 'local_version')) cols.local_version = localVersion;
        const set = Object.keys(cols).filter((c) => c !== def.pk);
        db.prepare(`UPDATE ${table} SET ${set.map((c) => `${quoteId(c)} = ?`).join(', ')} WHERE ${pk} = ?`)
          .run(...set.map((c) => bindable(cols[c])), id);
      } else {
        // Defaults that mark the row as "local, never pushed" must be in `cols` BEFORE the column
        // list is frozen — otherwise the INSERT omits them and the schema defaults (version 1,
        // local_version 0) claim the server has already seen a row it has never heard of.
        if (hasColumn(db, def.table, 'created_at') && !('created_at' in cols)) cols.created_at = at;
        if (hasColumn(db, def.table, 'local_version') && !('local_version' in cols)) cols.local_version = 1;
        if (hasColumn(db, def.table, 'version') && !('version' in cols)) {
          // A locally created row has no server version yet; 0 says "never seen by the server".
          cols.version = 0;
        }
        const insertCols = [def.pk, ...Object.keys(cols).filter((c) => c !== def.pk)];
        db.prepare(`INSERT INTO ${table} (${insertCols.map(quoteId).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`)
          .run(...insertCols.map((c) => bindable(c === def.pk ? id : (cols[c] === undefined ? null : cols[c]))));
      }

      const stored = db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(id);
      const baseVersion = Number(existing?.version ?? 0) || 0;
      const op = queueRowOp(def, id, data, baseVersion, 0);
      return { ok: true, entity: def.entity, id, row: stored, queued_as: op.op_id, synced: 0 };
    })();
  }

  /** Soft delete: tombstone locally, queue the tombstone. Nothing is ever hard-deleted. */
  function remove(name, id) {
    const def = registry.rowEntity(String(name ?? ''));
    if (!def) return { ok: false, error: 'UNKNOWN_OR_READ_ONLY', message: `${name} is not a row-syncable entity` };
    if (!isId(String(id))) return { ok: false, error: 'BAD_ID', message: 'Invalid id' };
    if (!hasColumn(db, def.table, 'deleted')) {
      return { ok: false, error: 'NO_TOMBSTONE', message: `${def.table} has no deleted column locally; refusing to hard-delete` };
    }
    return db.transaction(() => {
      const table = quoteId(def.table);
      const pk = quoteId(def.pk);
      const existing = db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(String(id));
      if (!existing) return { ok: false, error: 'NOT_FOUND', message: `${def.entity} ${id} is not in the local database` };
      const data = writableSnapshot(def, existing);
      const cols = { ...data, deleted: 1, synced: 0, local_version: Number(existing.local_version ?? 0) + 1 };
      if (hasColumn(db, def.table, 'updated_at')) cols.updated_at = nowIso();
      const set = Object.keys(cols);
      db.prepare(`UPDATE ${table} SET ${set.map((c) => `${quoteId(c)} = ?`).join(', ')} WHERE ${pk} = ?`)
        .run(...set.map((c) => bindable(cols[c])), String(id));
      const op = queueRowOp(def, String(id), data, Number(existing.version ?? 0) || 0, 1);
      return { ok: true, entity: def.entity, id: String(id), queued_as: op.op_id, deleted: 1 };
    })();
  }

  /**
   * Queue one row-tier intention. A record that has never been attempted is *replaced* rather than
   * duplicated, so twenty keystrokes in a product form become one push with one base_version. Once a
   * batch has been attempted the op is frozen and a new one is added, because the server has already
   * recorded a verdict against the old op_id and rewriting it would be a lie.
   */
  function queueRowOp(def, id, data, baseVersion, deleted) {
    const open = db.prepare(`SELECT op_id, tries, payload_json, base_version FROM outbox
      WHERE entity=? AND row_id=? AND kind='row' AND state='PENDING' AND tries=0
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(def.entity, id);
    const at = Date.now();
    if (open && Number(open.base_version) === Number(baseVersion)) {
      db.prepare(`UPDATE outbox SET payload_json=?, deleted=?, created_at=? WHERE op_id=?`)
        .run(JSON.stringify(data), deleted, at, open.op_id);
      return { op_id: open.op_id, coalesced: true };
    }
    const opId = ulid();
    db.prepare(`INSERT INTO outbox (op_id,entity,row_id,kind,payload_json,base_version,deleted,state,tries,created_at)
      VALUES (?,?,?,'row',?,?,?,'PENDING',0,?)`)
      .run(opId, def.entity, id, JSON.stringify(data), baseVersion, deleted, at);
    return { op_id: opId, coalesced: false };
  }

  /**
   * Queue a financial document as an INTENT. The desktop never writes sales/journal/stock rows —
   * the server's posting engine derives them, which is exactly why two devices selling the last bag
   * cannot double-count stock. The op_id doubles as idempotency_key, so a retry is a no-op.
   *
   * `key` lets a caller that already named its own intention — the renderer's legacy single-op
   * `/sync/push` body carries an `idempotency_key` — keep that name, so a second POST of the same
   * draft updates one queue row instead of adding a second document.
   */
  function command(opType, payload, key) {
    const def = registry.commandEntityByOpType(String(opType ?? ''));
    if (!def) return { ok: false, error: 'UNKNOWN_OP_TYPE', message: `Not a dispatchable command: ${opType}` };
    const body = payload && typeof payload === 'object' ? payload : null;
    if (!body) return { ok: false, error: 'BAD_PAYLOAD', message: 'command() needs a payload object' };
    const localTime = typeof body.local_time === 'string' && body.local_time ? body.local_time : nowIso();
    return db.transaction(() => {
      const opId = isId(key) ? String(key) : ulid();
      const ref = String(body.id ?? body.client_ref ?? opId).slice(0, 64);
      // Only a caller-supplied key can collide; a re-POST of the same draft rewrites that one row.
      const existing = isId(key) ? db.prepare('SELECT state FROM outbox WHERE op_id=?').get(opId) : null;
      if (existing) {
        if (existing.state !== 'PENDING') {
          return { ok: false, error: 'ALREADY_SYNCED',
            message: `Intention ${opId} was already answered (${existing.state}) and cannot be rewritten` };
        }
        db.prepare(`UPDATE outbox SET payload_json=?, created_at=? WHERE op_id=?`)
          .run(JSON.stringify({ type: def.opType, payload: body, local_time: localTime }), Date.now(), opId);
        return { ok: true, queued_as: opId, entity: def.entity, op_type: def.opType, idempotency_key: opId, coalesced: true };
      }
      db.prepare(`INSERT INTO outbox (op_id,entity,row_id,kind,payload_json,base_version,deleted,state,tries,created_at)
        VALUES (?,?,?,'command',?,?,0,'PENDING',0,?)`)
        .run(opId, def.entity, ref, JSON.stringify({ type: def.opType, payload: body, local_time: localTime }), 0, Date.now());
      return { ok: true, queued_as: opId, entity: def.entity, op_type: def.opType, idempotency_key: opId, coalesced: false };
    })();
  }
  // outbox.op_id IS the server-side idempotency_key: the same key on a retry is answered from the
  // server's ledger instead of being posted twice, which is what makes a lost response safe.

  // ───────────────────────────────────────────────────────────── outbox ─────
  const outbox = {
    pending(kind, limit) {
      return db.prepare(`SELECT * FROM outbox WHERE kind=? AND state IN ('PENDING','FAILED')
        ORDER BY created_at, rowid LIMIT ?`).all(kind, limit);
    },
    counts() {
      const out = { PENDING: 0, SYNCED: 0, CONFLICT: 0, FAILED: 0 };
      for (const r of db.prepare('SELECT state, COUNT(*) n FROM outbox GROUP BY state').all()) out[r.state] = r.n;
      return out;
    },
    mark(opId, state, { error = null, bumpTries = false } = {}) {
      if (bumpTries) {
        db.prepare(`UPDATE outbox SET state=?, error=?, tries=tries+1 WHERE op_id=?`).run(state, error, opId);
      } else {
        db.prepare('UPDATE outbox SET state=?, error=? WHERE op_id=?').run(state, error, opId);
      }
    },
    get: (opId) => db.prepare('SELECT * FROM outbox WHERE op_id=?').get(opId) ?? null,
    /** After a push verdict, retire everything the server has now answered for this row. */
    supersedeOlder(entity, rowId, keepOpId) {
      db.prepare(`UPDATE outbox SET state='SYNCED', error='superseded by a later edit of the same record'
        WHERE entity=? AND row_id=? AND kind='row' AND state IN ('PENDING','FAILED') AND op_id<>?`)
        .run(entity, rowId, keepOpId);
    },
    list({ state = null, limit = 100 } = {}) {
      const rows = state
        ? db.prepare('SELECT * FROM outbox WHERE state=? ORDER BY created_at DESC LIMIT ?').all(state, limit)
        : db.prepare('SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map((r) => ({ ...r, payload: safeParse(r.payload_json) }));
    },
  };

  // ────────────────────────────────────────────────────────── conflicts ─────
  const conflicts = {
    add({ entity, rowId, localData, serverData, reason }) {
      const at = Date.now();
      const existing = db.prepare(`SELECT id FROM local_conflicts WHERE entity=? AND row_id=? AND resolved_at IS NULL`)
        .get(entity, rowId);
      const localJson = strOr(localData);
      const serverJson = strOr(serverData);
      if (existing) {
        db.prepare(`UPDATE local_conflicts SET local_data=?, server_data=?, reason=?, created_at=? WHERE id=?`)
          .run(localJson, serverJson, reason, at, existing.id);
        return existing.id;
      }
      const id = ulid();
      db.prepare(`INSERT INTO local_conflicts (id,entity,row_id,local_data,server_data,reason,created_at,resolved_at)
        VALUES (?,?,?,?,?,?,?,NULL)`).run(id, entity, rowId, localJson, serverJson, reason, at);
      return id;
    },
    list({ includeResolved = false, limit = 200 } = {}) {
      const rows = includeResolved
        ? db.prepare('SELECT * FROM local_conflicts ORDER BY created_at DESC LIMIT ?').all(limit)
        : db.prepare('SELECT * FROM local_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map((r) => ({ ...r, local: safeParse(r.local_data), server: safeParse(r.server_data) }));
    },
    openCount: () => db.prepare('SELECT COUNT(*) n FROM local_conflicts WHERE resolved_at IS NULL').get().n,

    /**
     * keep_server — the stashed local edit is abandoned (recorded, never invisible) and the row is
     *               marked clean so the next pull replaces it with the server copy.
     * reapply_mine — the stashed edit becomes the local truth again, queued against the *current*
     *               server version, so the push wins this time instead of colliding again.
     */
    resolve(id, choice) {
      const chosen = String(choice ?? '');
      if (chosen !== 'keep_server' && chosen !== 'reapply_mine') {
        return { ok: false, error: 'BAD_CHOICE', message: "choice must be 'keep_server' or 'reapply_mine'" };
      }
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM local_conflicts WHERE id=?').get(id);
        if (!row) return { ok: false, error: 'NOT_FOUND', message: 'No such conflict' };
        const entity = registry.entityOf(row.entity);
        if (!entity || entity.tier !== 'row') {
          return { ok: false, error: 'NOT_ROW_ENTITY', message: `${row.entity} is not a row-tier entity` };
        }
        const local = safeParse(row.local_data) ?? {};
        const server = safeParse(row.server_data) ?? {};
        const table = quoteId(entity.table);
        const pk = quoteId(entity.pk);
        const current = db.prepare(`SELECT * FROM ${table} WHERE ${pk} = ?`).get(row.row_id) ?? null;
        const resolvedAt = Date.now();
        let resolved = {};

        if (chosen === 'keep_server') {
          if (current) {
            const set = { synced: 1, local_version: Number(current.local_version ?? 0) + 1 };
            if (typeof server.version === 'number') set.version = server.version;
            if (typeof server.updated_at === 'string') set.updated_at = server.updated_at;
            if (typeof server.deleted === 'number') set.deleted = server.deleted;
            db.prepare(`UPDATE ${table} SET ${Object.keys(set).map((c) => `${quoteId(c)} = ?`).join(', ')} WHERE ${pk} = ?`)
              .run(...Object.values(set).map(bindable), row.row_id);
            // The push response only reports version/updated_at/deleted, so make the next delta pull
            // bring the full server row back by rewinding this entity's cursor just under its stamp.
            if (typeof server.updated_at === 'string') rewindCursor(entity, server.updated_at);
          }
          // The abandoned edit stops being pending, but stays in the queue as a CONFLICT the shop can
          // still read back — retiring it silently would be the data loss this table exists to avoid.
          db.prepare(`UPDATE outbox SET state='CONFLICT', error='RESOLVED:keep_server'
            WHERE entity=? AND row_id=? AND kind='row' AND state IN ('PENDING','FAILED')`).run(entity.entity, row.row_id);
        } else {
          const data = registry.sanitizeRowData(entity, local);
          if (current) {
            const cols = { ...data };
            if (hasColumn(db, entity.table, 'updated_at')) cols.updated_at = nowIso();
            if (hasColumn(db, entity.table, 'deleted')) cols.deleted = Number(local.deleted ?? current.deleted ?? 0);
            if (hasColumn(db, entity.table, 'synced')) cols.synced = 0;
            if (hasColumn(db, entity.table, 'local_version')) cols.local_version = Number(current.local_version ?? 0) + 1;
            const set = Object.keys(cols);
            db.prepare(`UPDATE ${table} SET ${set.map((c) => `${quoteId(c)} = ?`).join(', ')} WHERE ${pk} = ?`)
              .run(...set.map((c) => bindable(cols[c])), row.row_id);
          }
          // The server copy in the conflict is authoritative for the version the edit must be based
          // on — the local row still carries the version it had before the conflicting pull.
          const baseVersion = Number(server.version ?? current?.version ?? 0) || 0;
          const deleted = Number((current?.deleted ?? local.deleted) || 0);
          // Retire the rejected attempt first, then queue the user's edit against the version the
          // server is on now — the next push carries a fresh base_version and therefore wins.
          db.prepare(`UPDATE outbox SET state='SYNCED', error='superseded by reapply_mine'
            WHERE entity=? AND row_id=? AND kind='row' AND state IN ('PENDING','FAILED')`).run(entity.entity, row.row_id);
          db.prepare(`UPDATE outbox SET state='CONFLICT', error='RESOLVED:reapply_mine'
            WHERE entity=? AND row_id=? AND kind='row' AND state='CONFLICT'`).run(entity.entity, row.row_id);
          const op = queueRowOp(entity, row.row_id, data, baseVersion, deleted);
          resolved = { queued_as: op.op_id };
        }

        db.prepare('UPDATE local_conflicts SET resolved_at=? WHERE id=?').run(resolvedAt, id);
        return { ok: true, id, choice: chosen, entity: row.entity, row_id: row.row_id, ...resolved };
      })();
    },
  };

  /**
   * Make the next delta pull return this row again. The server compares `updated_at > since`, so a
   * cursor truncated to the second is strictly older than the row it must re-fetch, and the rows it
   * drags back with it are simply re-applied (pulls are idempotent upserts).
   */
  function rewindCursor(def, serverUpdatedAt) {
    const key = cursorKey(def.entity);
    const stored = String(meta.get(key, '') ?? '');
    const rewind = `${String(serverUpdatedAt).slice(0, 19)}.000Z`;
    if (!stored || rewind < stored) meta.set(key, rewind);
  }

  // ───────────────────────────────────────────────────────── pull apply ─────
  /**
   * Write one page of /sync/pull. Called with `{entity: {rows, cursor, has_more}}`.
   * Whole page = one transaction, and the cursors move inside it, so a crash mid-page replays the
   * same page instead of losing rows. Full-refresh tables are cleared and re-inserted — but only if
   * the server says it sent the whole table (`has_more: false`); clearing a truncated table would
   * delete local history for no reason, so that case is refused and reported instead.
   */
  function applyPullPage(entities) {
    const summary = { applied: 0, skipped_dirty: 0, rejected: 0, tables: {}, cursors: {}, full_refresh: [], refused: [] };
    const plan = [];

    for (const [name, slice] of Object.entries(entities ?? {})) {
      const def = registry.entityOf(name);
      if (!def || def.tier === 'command') continue;               // commands never arrive as rows
      if (!slice || !Array.isArray(slice.rows)) continue;
      if (!hasTable(def.table)) { summary.refused.push({ entity: name, reason: 'TABLE_MISSING' }); continue; }
      const localCols = new Set(columnNames(def.table));
      const unknown = new Set();
      for (const row of slice.rows) for (const k of Object.keys(row)) if (!localCols.has(k)) unknown.add(k);
      for (const col of unknown) {
        const tag = `${def.table}.${col}`;
        if (!warnOnce.has(tag)) {
          warnOnce.add(tag);
          log('server sent a column the local schema does not have — replay migrations and restart', { entity: name, column: col });
        }
      }
      plan.push({ name, def, slice });
      summary.cursors[name] = { cursor: String(slice.cursor ?? ''), has_more: !!slice.has_more };
    }

    const write = () => {
      // Deferred FK checks let one page land in any order (a sale line can arrive without its sale
      // header when only the line changed). The setting is scoped to the transaction and resets at
      // commit, where integrity is still enforced — so a bad page can never leave a half-applied one.
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const { name, def, slice } of plan) {
        const res = applyEntitySlice(def, slice);
        summary.applied += res.applied;
        summary.skipped_dirty += res.skipped_dirty;
        summary.rejected += res.rejected;
        summary.tables[name] = { rows: slice.rows.length, ...res };
        if (res.cleared) summary.full_refresh.push(name);
        if (res.refused) summary.refused.push({ entity: name, reason: res.refused });
      }
      // Cursors move in the same transaction as the rows: commit both or neither.
      for (const [name, c] of Object.entries(summary.cursors)) {
        const def = registry.entityOf(name);
        if (!def || def.full_refresh) continue;                    // '' is not a cursor
        if (c.cursor) setCursor(name, c.cursor);
      }
      return summary;
    };

    return db.transaction(write)();
  }

  function applyEntitySlice(def, slice) {
    const out = { applied: 0, skipped_dirty: 0, rejected: 0, cleared: false, refused: null };
    const table = quoteId(def.table);
    const idCols = (def.pk_cols ?? [def.pk]).map(String);
    const localCols = new Set(columnNames(def.table));
    const rows = slice.rows ?? [];

    if (def.full_refresh) {
      // A truncated wholesale table must never replace a complete local one.
      if (slice.has_more) { out.refused = 'FULL_REFRESH_TRUNCATED'; out.need_limit = rows.length; return out; }
      db.prepare(`DELETE FROM ${table}`).run();
      out.cleared = true;
      if (!rows.length) return out;
    }

    for (const raw of rows) {
      const data = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k === 'synced' || k === 'local_version') continue;      // desktop-owned, always
        if (localCols.has(k)) data[k] = bindable(v);
      }
      // A row the local table cannot be keyed by is a server/registry disagreement, not data.
      if (idCols.some((c) => !(c in data)) || idCols.some((c) => data[c] === null || data[c] === undefined)) {
        conflicts.add({ entity: def.entity, rowId: String(data[def.pk] ?? ''), localData: null, serverData: raw, reason: 'NO_IDENTITY' });
        out.rejected++;
        continue;
      }
      const where = idCols.map((c) => `${quoteId(c)} = ?`).join(' AND ');
      const values = idCols.map((c) => data[c]);

      if (!def.full_refresh) {
        const existing = db.prepare(`SELECT synced FROM ${table} WHERE ${where}`).get(...values);
        // Invariant 1: a dirty local row is never overwritten. The server copy is parked, not dropped.
        if (existing && Number(existing.synced) === 0) {
          const full = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...values);
          conflicts.add({ entity: def.entity, rowId: String(values[0]), localData: full, serverData: raw, reason: 'DIRTY_LOCAL' });
          out.skipped_dirty++;
          continue;
        }
      }

      const names = Object.keys(data);
      const insertCols = [...names, 'synced', 'local_version'];
      const placeholders = insertCols.map(() => '?').join(', ');
      if (def.full_refresh) {
        // The table was just emptied, so a plain insert cannot collide.
        db.prepare(`INSERT INTO ${table} (${insertCols.map(quoteId).join(', ')}) VALUES (${placeholders})`)
          .run(...names.map((n) => data[n]), 1, 1);
      } else {
        const setList = names.map((n) => `${quoteId(n)} = excluded.${quoteId(n)}`).join(', ');
        db.prepare(`INSERT INTO ${table} (${insertCols.map(quoteId).join(', ')}) VALUES (${placeholders})
          ON CONFLICT(${idCols.map(quoteId).join(', ')})
          DO UPDATE SET ${setList}, synced = 1, local_version = ${table}.local_version + 1`)
          .run(...names.map((n) => data[n]), 1, 1);
      }
      out.applied++;
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────── status ─────
  function pendingCount() {
    return db.prepare(`SELECT COUNT(*) n FROM outbox WHERE state IN ('PENDING','FAILED')`).get().n;
  }
  function dirtyCount() {
    let n = 0;
    for (const table of registry.LOCAL_TRACKED_TABLES) {
      if (!hasTable(table) || !hasColumn(db, table, 'synced')) continue;
      n += db.prepare(`SELECT COUNT(*) c FROM ${quoteId(table)} WHERE synced = 0`).get().c;
    }
    return n;
  }
  /** Used by the engine to re-fetch exactly the rows a rejected push touched. */
  function dirtyEntities() {
    const out = [];
    for (const def of registry.ROW_ENTITIES) {
      if (!hasTable(def.table) || !hasColumn(db, def.table, 'synced')) continue;
      const n = db.prepare(`SELECT COUNT(*) c FROM ${quoteId(def.table)} WHERE synced = 0`).get().c;
      if (n) out.push({ entity: def.entity, count: n });
    }
    return out;
  }

  return {
    db,
    file,
    log,
    boot,
    meta,
    deviceId,
    cursorFor,
    setCursor,
    rewindCursor,
    list,
    get,
    save,
    remove,
    command,
    outbox,
    conflicts,
    applyPullPage,
    pendingCount,
    dirtyCount,
    dirtyEntities,
    hasTable,
    columnsOf,
    entityNames: () => registry.ALL_ENTITIES.map((e) => e.entity),
    close: () => { try { db.close(); } catch { /* already closed */ } },
  };
}

function safeParse(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return null; }
}
const strOr = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));

module.exports = { openLocalDb, createStore, buildLocalSchema, ulid, nowIso, quoteId, CROCKFORD, MAX_LIMIT };
