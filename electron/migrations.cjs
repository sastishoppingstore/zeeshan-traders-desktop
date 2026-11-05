/**
 * Replay of the repo's own D1 migrations into the desktop's local SQLite file.
 *
 * Why replay instead of a copied schema: the server schema is the contract. A hand-maintained copy
 * in electron/ would drift the first time somebody adds a column in migrations/, and the desktop
 * would then drop that column from every synced row without noticing. Replaying the real files
 * means the desktop's schema is the server's schema by construction.
 *
 * Two things have to change for a local replay, and both are auditable:
 *   1. Cloudflare internals (`_cf_KV`, `d1_migrations`, …) are filtered statement by statement,
 *      because those tables exist only inside D1 and reading one from plain SQLite gives SQLITE_AUTH.
 *   2. The migration journal is our own `schema_version` table, so a re-run is a no-op. wrangler's
 *      `d1_migrations` is not available to us and must not be faked.
 *
 * A statement that genuinely cannot run in better-sqlite3 is recorded, never swallowed quietly:
 * the failure is kept in `schema_version.failures`, mirrored into `meta`, and re-logged at every
 * start so it shows up in the ops screen instead of becoming a missing column three months later.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { planMigration } = require('./sql-statements.cjs');

const GENERATED = path.join(__dirname, 'migrations.generated.cjs');

/** Candidate locations for migrations/, in order. Packaged builds get them via electron-builder extraResources. */
function migrationsDirCandidates(appRoot = path.resolve(__dirname, '..')) {
  const res = process.resourcesPath;
  return [
    path.join(appRoot, 'migrations'),
    path.resolve(__dirname, '..', 'migrations'),
    path.resolve(__dirname, '..', '..', 'migrations'),
    ...(res ? [path.join(res, 'migrations'), path.join(res, 'app', 'migrations')] : []),
    '/opt/zeyad-shop/migrations',
  ];
}

function findMigrationsDir(appRoot) {
  return migrationsDirCandidates(appRoot).find((dir) => {
    try { return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.sql')); }
    catch { return false; }
  }) ?? null;
}

/**
 * Ordered migration files. Prefers the live `migrations/` directory (dev + packaged-with-resources)
 * and falls back to the generated SQL snapshot, which is what makes a packaged build work even when
 * extraResources were not configured.
 */
function readMigrations(appRoot) {
  const dir = findMigrationsDir(appRoot);
  if (dir) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    return {
      source: dir,
      files: files.map((f) => ({ name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') })),
    };
  }
  if (fs.existsSync(GENERATED)) {
    const snap = require(GENERATED);
    return {
      source: `${GENERATED} (snapshot)`,
      files: snap.ORDER.map((name) => ({ name, sql: snap.SQL[name] })),
    };
  }
  const err = new Error('No migrations found: looked for migrations/*.sql and electron/migrations.generated.cjs');
  err.code = 'NO_MIGRATIONS';
  throw err;
}

function schemaFingerprint(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(f.name).update('\0').update(f.sql);
  return h.digest('hex').slice(0, 16);
}

const JOURNAL = `
CREATE TABLE IF NOT EXISTS schema_version (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  statements INTEGER NOT NULL DEFAULT 0,
  failures   TEXT NOT NULL DEFAULT ''
)`;

/** Errors that mean "this DDL is already in place", i.e. a safe no-op rather than a failure. */
function isAlreadyApplied(message) {
  return /duplicate column name/i.test(message)
    || /already exists/i.test(message);          // table/index/view present from an earlier partial run
}

/**
 * Apply every migration the local DB has not recorded yet.
 * `db` is a better-sqlite3 handle (only .exec / .prepare().run() / .prepare().get() are used, so the
 * journal path can also be exercised against node:sqlite in verify-migrations.cjs).
 */
function applyServerSchema(db, { appRoot, log = () => {} } = {}) {
  db.exec(JOURNAL);
  const { files, source } = readMigrations(appRoot);
  const done = new Set(db.prepare('SELECT name FROM schema_version').all().map((r) => r.name));
  const result = { source, fingerprint: schemaFingerprint(files), applied: [], noop: [], failures: [] };

  for (const file of files) {
    if (done.has(file.name)) { result.noop.push(file.name); continue; }
    const { run, skipped } = planMigration(file.sql);
    const fileFailures = [];

    for (const st of run) {
      try {
        db.prepare(st.sql).run();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (isAlreadyApplied(message)) { result.idempotent = (result.idempotent ?? 0) + 1; continue; }
        fileFailures.push({ line: st.line, error: message, sql: st.sql.slice(0, 200) });
        log('migration statement failed', { file: file.name, line: st.line, error: message });
      }
    }

    db.prepare(`INSERT INTO schema_version (name, applied_at, statements, failures) VALUES (?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET applied_at=excluded.applied_at,
        statements=excluded.statements, failures=excluded.failures`)
      .run(file.name, new Date().toISOString(), run.length, JSON.stringify(fileFailures));

    if (skipped.length) {
      log('migration statements filtered out as Cloudflare-internal / per-connection',
        { file: file.name, skipped: skipped.map((s) => `line ${s.line}: ${s.reason}`) });
    }
    result.applied.push({
      file: file.name,
      statements: run.length,
      skipped: skipped.length,
      failures: fileFailures.length,
    });
    for (const f of fileFailures) result.failures.push({ file: file.name, ...f });
  }
  return result;
}

/** Columns currently on a table — used everywhere the desktop must not assume a schema by memory. */
function tableColumns(db, table) {
  return db.prepare('SELECT name, type, "notnull" AS notnull, dflt_value, pk FROM pragma_table_info(?)')
    .all(table);
}

function hasColumn(db, table, column) {
  return tableColumns(db, table).some((c) => c.name === column);
}

function tableExists(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

module.exports = {
  migrationsDirCandidates,
  findMigrationsDir,
  readMigrations,
  schemaFingerprint,
  applyServerSchema,
  tableColumns,
  hasColumn,
  tableExists,
  isAlreadyApplied,
  GENERATED,
};
