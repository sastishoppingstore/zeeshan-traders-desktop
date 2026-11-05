#!/usr/bin/env node
/**
 * Dev-only generator: reads packages/shared/src/sync.ts and emits electron/registry.cjs.
 *
 * Why a generator instead of `require('../../packages/shared/src/sync.ts')` at runtime:
 * Electron ships its own Node build, and TypeScript type-stripping (which would make that require
 * work on a dev machine) is not guaranteed to be enabled there. The main process therefore runs
 * against a plain CommonJS mirror, and verify-registry.cjs keeps the mirror honest.
 *
 *   node electron/gen-registry.cjs          # rewrite registry.cjs from the TS source
 *
 * The emitted file is committed on purpose: it is the runtime input, not a build artifact that
 * must be regenerated for the app to start.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const TS_SOURCE = path.join(REPO, 'packages', 'shared', 'src', 'sync.ts');
const OUT = path.join(__dirname, 'registry.cjs');

function loadTs() {
  try {
    // Works on Node >= 23.6 (type stripping on by default) and Node 22 with --experimental-strip-types.
    return require(TS_SOURCE);
  } catch (e) {
    process.stderr.write(
      'gen-registry: cannot load packages/shared/src/sync.ts with this Node (' + process.version + ').\n' +
      'Node 22 needs `node --experimental-strip-types electron/gen-registry.cjs`; Node 23.6+ works as-is.\n' +
      e.message + '\n');
    process.exit(2);
  }
}

const mod = loadTs();
for (const key of ['ROW_ENTITIES', 'COMMAND_ENTITIES', 'REPLICA_ENTITIES', 'ALL_ENTITIES']) {
  if (!Array.isArray(mod[key])) {
    process.stderr.write(`gen-registry: ${key} missing from the TS registry — refusing to write a partial mirror.\n`);
    process.exit(2);
  }
}

const hash = crypto.createHash('sha256').update(fs.readFileSync(TS_SOURCE)).digest('hex').slice(0, 16);
const j = (v) => JSON.stringify(v, null, 2);

const out = `/**
 * Offline-sync registry — GENERATED, DO NOT EDIT BY HAND.
 *
 *   source    packages/shared/src/sync.ts   (sha256 ${hash})
 *   generator electron/gen-registry.cjs     (re-run it after editing the TS registry)
 *   gate      electron/verify-registry.cjs  (exits non-zero if this mirror drifts)
 *
 * packages/shared/src/sync.ts is the single source of truth for the whole repo. This file exists
 * only because Electron's main process must be plain CommonJS with no bundler step, so the same
 * data is emitted here in a form the main process can require() without Node's TS type stripping.
 * Keep the tier rules in the TS file; change nothing about them here.
 */
'use strict';

const SOURCE = ${j({ file: 'packages/shared/src/sync.ts', sha256: hash, generated_by: 'electron/gen-registry.cjs' })};

/** row tier — master data, bidirectional, optimistic-locked by \`version\`. */
const ROW_ENTITIES = ${j(mod.ROW_ENTITIES)};

/** command tier — financial documents: the client sends an INTENT, the server posts the ledger. */
const COMMAND_ENTITIES = ${j(mod.COMMAND_ENTITIES)};

/** replica tier — server-derived, pull-only. A client write for these is never accepted. */
const REPLICA_ENTITIES = ${j(mod.REPLICA_ENTITIES)};

const ALL_ENTITIES = [...ROW_ENTITIES, ...COMMAND_ENTITIES, ...REPLICA_ENTITIES];

const BY_NAME = new Map(ALL_ENTITIES.map((e) => [e.entity, e]));
const BY_TABLE = new Map(ALL_ENTITIES.map((e) => [e.tier + ':' + e.table, e]));

const entityOf = (name) => BY_NAME.get(name);
const rowEntity = (name) => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'row' ? e : undefined;
};
const commandEntity = (name) => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'command' ? e : undefined;
};
const commandEntityByOpType = (opType) => COMMAND_ENTITIES.find((e) => e.opType === opType);
const replicaEntity = (name) => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'replica' ? e : undefined;
};
const replicaByTable = (table) => REPLICA_ENTITIES.find((e) => e.table === table);

/** Table names owned by the sync layer — used to prove no table was forgotten. */
const SYNCED_TABLES = new Set(ALL_ENTITIES.map((e) => e.table));

/** Every table that the desktop mirrors locally and therefore needs the \`synced\` column. */
const LOCAL_TRACKED_TABLES = [...new Set(
  [...ROW_ENTITIES, ...REPLICA_ENTITIES].map((e) => e.table),
)];

/**
 * Clamp a client-supplied column bag to the entity whitelist and SQLite-safe scalars.
 * Mirrors sanitizeRowData() in packages/shared/src/sync.ts — verify-registry.cjs diffs the two
 * implementations against shared fixtures rather than trusting this comment.
 */
function sanitizeRowData(def, raw) {
  const src = raw ?? {};
  const out = {};
  for (const col of def.columns) {
    const value = src[col];
    if (value === undefined) continue;
    if (value === null) { out[col] = null; continue; }
    if (typeof value === 'boolean') out[col] = value ? 1 : 0;
    else if (typeof value === 'string' || typeof value === 'number') out[col] = value;
    // Objects/arrays are never legitimate column values in this schema: drop them.
  }
  return out;
}

/**
 * Which entity name should a *read* of this table go through? \`sales\` is both a command entity and
 * a replica entity; reads must use the replica definition (cursor + tier), writes must not use it
 * at all. The registry is the only place that decides this.
 */
function readableFor(name) {
  return replicaEntity(name) ?? rowEntity(name) ?? commandEntity(name);
}

function writableForRow(name) {
  return rowEntity(name);
}

module.exports = {
  SOURCE,
  ROW_ENTITIES,
  COMMAND_ENTITIES,
  REPLICA_ENTITIES,
  ALL_ENTITIES,
  SYNCED_TABLES,
  LOCAL_TRACKED_TABLES,
  entityOf,
  rowEntity,
  commandEntity,
  commandEntityByOpType,
  replicaEntity,
  replicaByTable,
  readableFor,
  writableForRow,
  sanitizeRowData,
};
`;

fs.writeFileSync(OUT, out, 'utf8');
process.stdout.write(
  `wrote electron/registry.cjs from packages/shared/src/sync.ts ` +
  `(row ${mod.ROW_ENTITIES.length}, command ${mod.COMMAND_ENTITIES.length}, replica ${mod.REPLICA_ENTITIES.length})\n`);
