#!/usr/bin/env node
/**
 * Drift gate for electron/registry.cjs.
 *
 * The Electron main process runs against a generated CommonJS mirror of
 * packages/shared/src/sync.ts. If the two ever disagree, a desktop push could write a column the
 * server will strip, or miss a table the web clients are already editing — silent data loss. So
 * this script compares the mirror against the TS registry, structurally *and* behaviourally, and
 * exits non-zero on any difference. Run it in CI next to `npm run typecheck`.
 *
 *   node electron/verify-registry.cjs
 */
const path = require('node:path');
const assert = require('node:assert');

const REPO = path.resolve(__dirname, '..');
const TS = require(path.join(REPO, 'packages', 'shared', 'src', 'sync.ts'));
const CJS = require(path.join(__dirname, 'registry.cjs'));

const problems = [];
const check = (label, fn) => {
  try { fn(); } catch (e) { problems.push(`${label}: ${e.message.split('\n')[0]}`); }
};

// ----------------------------------------------------------------- structure ----
for (const key of ['ROW_ENTITIES', 'COMMAND_ENTITIES', 'REPLICA_ENTITIES']) {
  check(key, () => assert.deepStrictEqual(CJS[key], TS[key],
    `mirror differs (${TS[key].length} entries in TS, ${CJS[key].length} in registry.cjs)`));
}
check('tier of every entity', () => {
  for (const e of TS.ALL_ENTITIES) {
    const m = CJS.entityOf(e.entity);
    assert.ok(m, `entity ${e.entity} missing from mirror`);
    assert.strictEqual(m.tier, e.tier, `${e.entity} tier`);
    assert.strictEqual(m.table, e.table, `${e.entity} table`);
    assert.strictEqual(m.pk, e.pk, `${e.entity} pk`);
  }
});
check('SYNCED_TABLES', () =>
  assert.deepStrictEqual([...CJS.SYNCED_TABLES].sort(), [...TS.SYNCED_TABLES].sort()));
check('lookups', () => {
  for (const e of TS.ROW_ENTITIES) assert.strictEqual(CJS.rowEntity(e.entity)?.table, e.table, `rowEntity ${e.entity}`);
  for (const e of TS.REPLICA_ENTITIES) {
    assert.strictEqual(CJS.replicaEntity(e.entity)?.cursor, e.cursor, `replicaEntity ${e.entity}`);
    assert.strictEqual(CJS.replicaByTable(e.table)?.entity, e.entity, `replicaByTable ${e.table}`);
  }
  for (const e of TS.COMMAND_ENTITIES) {
    assert.strictEqual(CJS.commandEntity(e.entity)?.opType, e.opType, `commandEntity ${e.entity}`);
    assert.strictEqual(CJS.commandEntityByOpType(e.opType)?.entity, e.entity, `opType ${e.opType}`);
  }
});

// -------------------------------------------------------------- behaviour ----
/** Shared fixtures covering every value shape sanitizeRowData() can meet. */
const SAMPLES = [
  { name_en: 'Plain', version: 99, updated_at: '1999-01-01T00:00:00.000Z', created_by: 'attacker', slug: 'hijacked', deleted: 1 },
  { is_active: true, is_published: false, sale_rate_paisa: 0, conversion_ratio_milli: 1000, notes: null },
  { name_ur: '', tax_pct_milli: 12.5, meta: { a: 1 }, tags: ['x'], qty: undefined },
  {},
];
check('sanitizeRowData behaviour', () => {
  for (const def of TS.ROW_ENTITIES) {
    const cjsDef = CJS.rowEntity(def.entity);
    for (const sample of SAMPLES) {
      const mine = CJS.sanitizeRowData(cjsDef, sample);
      const theirs = TS.sanitizeRowData(def, sample);
      assert.deepStrictEqual(mine, theirs, `${def.entity} on ${JSON.stringify(sample)}`);
    }
  }
});

// ------------------------------------------------------------------ report ----
const counts = `row ${CJS.ROW_ENTITIES.length} / command ${CJS.COMMAND_ENTITIES.length} / replica ${CJS.REPLICA_ENTITIES.length}`;
if (problems.length) {
  process.stderr.write(`registry.cjs has drifted from packages/shared/src/sync.ts (${counts})\n`);
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write('\nFix: node electron/gen-registry.cjs\n');
  process.exit(1);
}
process.stdout.write(`registry.cjs matches packages/shared/src/sync.ts (${counts}, ${CJS.SYNCED_TABLES.size} tables)\n`);
