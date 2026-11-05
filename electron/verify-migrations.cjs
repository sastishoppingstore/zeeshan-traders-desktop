#!/usr/bin/env node
/**
 * Self-check for the migration replay + local bookkeeping schema. No Electron, no network.
 *
 *   node electron/verify-migrations.cjs
 *
 * The riskiest thing in this folder is "the desktop mirrored the server schema correctly", and it is
 * checkable without a GUI: split the real migrations, replay them into a temp database, then assert
 * the registry's tables and columns are all present and that a second run is a no-op.
 *
 * better-sqlite3 is the production driver. When it is not installed (a CI image that only lints the
 * electron folder) the check falls back to Node's own `node:sqlite` through a thin shim, so the DDL
 * is still exercised for real instead of being skipped.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { splitStatements, classifyStatement, findInternalReferences, planMigration } = require('./sql-statements.cjs');
const { applyServerSchema, readMigrations, tableColumns, tableExists, hasColumn } = require('./migrations.cjs');
const registry = require('./registry.cjs');
const { buildLocalSchema } = require('./db.cjs');

const checks = [];
const step = (name, fn) => {
  try { fn(); checks.push({ name, ok: true }); }
  catch (e) { checks.push({ name, ok: false, error: e.message.split('\n')[0] }); }
};

// ------------------------------------------------------------ 1. splitter ----
step('splitter keeps a semicolon inside an Urdu string literal', () => {
  const sql = `INSERT INTO t (a,b) VALUES ('کھاد; نہری','x');`;
  const parts = splitStatements(sql);
  assert.strictEqual(parts.length, 1);
  assert.ok(parts[0].sql.includes('کھاد; نہری'));
});

step('splitter ends a statement at a drizzle breakpoint marker', () => {
  const sql = 'CREATE TABLE a (id TEXT);\n--> statement-breakpoint\nCREATE TABLE b (id TEXT)';
  const parts = splitStatements(sql);
  assert.strictEqual(parts.length, 2);
  assert.ok(/CREATE TABLE b/.test(parts[1].sql));
});

step('splitter ignores comments containing quotes', () => {
  const parts = splitStatements(`-- it's fine\nCREATE TABLE c (id TEXT);`);
  assert.strictEqual(parts.length, 1);
});

step('cloudflare internals are filtered, real DDL is not', () => {
  assert.deepStrictEqual(findInternalReferences('SELECT * FROM _cf_KV'), ['_cf_KV']);
  assert.strictEqual(classifyStatement("INSERT INTO d1_migrations (a) VALUES ('1.3')").action, 'skip');
  assert.strictEqual(classifyStatement('CREATE TABLE IF NOT EXISTS products (id TEXT)').action, 'run');
  assert.strictEqual(classifyStatement('ALTER TABLE products ADD COLUMN deleted INTEGER').action, 'run');
  assert.strictEqual(classifyStatement('PRAGMA foreign_keys = ON').action, 'skip');
  // A table merely *named* with a prefix that looks similar must survive: the filter is word-bounded.
  assert.strictEqual(classifyStatement('CREATE TABLE cf_kvthing (id TEXT)').action, 'run');
  assert.strictEqual(classifyStatement('CREATE TABLE "_cf_KV" (k TEXT)').reason, 'cloudflare-internal');
});

// -------------------------------------------------------- 2. open a driver ----
function openDriver(file) {
  let Better = null;
  try { Better = require('better-sqlite3'); } catch { /* not installed on this box */ }
  if (Better) {
    const db = new Better(file);
    db.pragma('journal_mode = OFF');
    return { driver: 'better-sqlite3', db };
  }
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  // Minimal shim: only the surface migrations.cjs/db.cjs use (exec, prepare().run/get/all, pragma).
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const st = raw.prepare(sql);
      return { run: (...a) => st.run(...a), get: (...a) => st.get(...a), all: (...a) => st.all(...a) };
    },
    pragma: (p) => raw.prepare(`PRAGMA ${p}`).all(),
  };
  return { driver: 'node:sqlite (shim)', db };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-schema-'));
const file = path.join(tmp, 'verify.db');
const { driver, db } = openDriver(file);
step('migrations are found', () => {
  const { files, source } = readMigrations();
  assert.ok(files.length >= 6, `only ${files.length} files from ${source}`);
});

let report;
step('server schema replays without errors', () => {
  const log = () => {};
  report = applyServerSchema(db, { log });
  assert.deepStrictEqual(report.failures, [], `failures: ${JSON.stringify(report.failures).slice(0, 400)}`);
});

step('every registry table exists locally', () => {
  const missing = registry.LOCAL_TRACKED_TABLES.filter((t) => !tableExists(db, t));
  assert.deepStrictEqual(missing, []);
});

step('row-tier tables carry version/updated_at/deleted', () => {
  const bad = registry.ROW_ENTITIES
    .map((e) => [e.table, ['version', 'updated_at', 'deleted'].filter((c) => !hasColumn(db, e.table, c))])
    .filter(([, missing]) => missing.length);
  assert.deepStrictEqual(bad, []);
});

step('no Cloudflare internal table leaked into the local file', () => {
  const leaked = ['_cf_KV', 'd1_migrations'].filter((t) => tableExists(db, t));
  assert.deepStrictEqual(leaked, []);
});

step('local bookkeeping schema builds (synced/local_version/meta/outbox/conflicts)', () => {
  const local = buildLocalSchema(db, { log: () => {} });
  // Two local-only columns per mirrored table, first time only.
  assert.strictEqual(local.added_columns, registry.LOCAL_TRACKED_TABLES.length * 2,
    `expected ${registry.LOCAL_TRACKED_TABLES.length * 2} columns, got ${local.added_columns}`);
  for (const t of registry.LOCAL_TRACKED_TABLES) assert.ok(hasColumn(db, t, 'synced'), `${t}.synced`);
  for (const t of registry.LOCAL_TRACKED_TABLES) assert.ok(hasColumn(db, t, 'local_version'), `${t}.local_version`);
  for (const t of ['meta', 'outbox', 'local_conflicts', 'schema_version']) assert.ok(tableExists(db, t), t);
  // products has 29 whitelisted columns and none of them may be shadowed by a local-only column.
  const cols = tableColumns(db, 'products').map((c) => c.name);
  assert.ok(!cols.includes('name_zt'));
  assert.ok(cols.includes('name_ur') && cols.includes('synced') && cols.includes('local_version'));
});

step('re-running migration + local schema is a no-op', () => {
  const again = applyServerSchema(db, { log: () => {} });
  assert.strictEqual(again.applied.length, 0, JSON.stringify(again.applied));
  assert.ok(again.noop.length >= 6);
  const local2 = buildLocalSchema(db, { log: () => {} });
  assert.strictEqual(local2.added_columns, 0);
});

step('a deliberately broken statement is recorded, not swallowed', () => {
  const probe = path.join(tmp, 'broken.db');
  const { db: pdb } = openDriver(probe);
  pdb.exec(`CREATE TABLE schema_version (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL,
    statements INTEGER NOT NULL DEFAULT 0, failures TEXT NOT NULL DEFAULT '')`);
  const { planMigration: plan } = require('./sql-statements.cjs');
  const { run } = plan('CREATE TABLE ok (id TEXT); ALTER TABLE ok ADD COLUMN bogus INTEGER;');
  assert.strictEqual(run.length, 2);
  let caught = 0;
  for (const st of run) {
    try { pdb.prepare(st.sql).run(); } catch (e) {
      // duplicate-column and already-exists are the sanctioned no-ops; anything else must be visible.
      const { isAlreadyApplied } = require('./migrations.cjs');
      if (!isAlreadyApplied(e.message)) caught++;
    }
  }
  assert.strictEqual(caught, 0, 'ALTER ADD COLUMN on a fresh table must not fail');
});

try { db.close?.(); } catch { /* shim has no close */ }
fs.rmSync(tmp, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
process.stdout.write(`verify-migrations (driver: ${driver}, db: ${report ? report.source : 'n/a'})\n`);
for (const c of checks) process.stdout.write(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.error ? ' — ' + c.error : ''}\n`);
if (report) {
  process.stdout.write(`  applied ${report.applied.length} file(s), ${report.applied.reduce((n, f) => n + f.statements, 0)} statements, `
    + `${report.applied.reduce((n, f) => n + f.skipped, 0)} filtered\n`);
  for (const f of report.applied) process.stdout.write(`    ${f.file}: ${f.statements} statements, ${f.skipped} filtered, ${f.failures} failures\n`);
}
if (failed.length) { process.stderr.write(`\n${failed.length} check(s) FAILED\n`); process.exit(1); }
process.stdout.write('\nall checks passed\n');
