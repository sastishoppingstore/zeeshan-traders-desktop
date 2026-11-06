/**
 * One driver, two backends.
 *
 * The packaged desktop uses better-sqlite3 — it is the module Electron ships against, rebuilt for the
 * Electron ABI by `npm run rebuild:native`. But the sync engine, the queue, the conflict ledger and the
 * local REST answers are all testable without a GUI, and CI on a Linux image does not have a Windows
 * native build. So the same code runs here against Node's own `node:sqlite` through the narrow shim
 * below, which implements exactly the surface `db.cjs` uses: exec, prepare().run/get/all, pragma,
 * transaction, close.
 *
 * The shim is a fallback, never a preference: if better-sqlite3 loads, nothing else is consulted.
 */
'use strict';

function betterDriver() {
  try {
    const Better = require('better-sqlite3');
    return { Driver: Better, kind: 'better-sqlite3' };
  } catch {
    return null;
  }
}

/** node:sqlite returns BigInt for some aggregates; the rest of the app speaks Number. */
const toNumber = (v) => (typeof v === 'bigint' ? Number(v) : v);
const plain = (row) => {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = toNumber(v);
  return out;
};

function nodeSqliteDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  let depth = 0;
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const st = raw.prepare(sql);
      return {
        run: (...a) => { const r = st.run(...a.map(normalise)); return { changes: toNumber(r.changes), last_rowid: toNumber(r.lastInsertRowid) }; },
        get: (...a) => plain(st.get(...a.map(normalise))) ?? null,
        all: (...a) => st.all(...a.map(normalise)).map(plain),
      };
    },
    pragma: (p) => raw.prepare(`PRAGMA ${p}`).all().map(plain),
    // better-sqlite3's transaction() nests with savepoints; SQLite's own BEGIN/COMMIT cannot nest, so a
    // counter keeps the same behaviour for the two places in db.cjs that call one inside the other.
    transaction: (fn) => (...args) => {
      const outer = depth === 0;
      raw.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT zt${depth}`);
      depth++;
      try {
        const out = fn(...args);
        depth--;
        raw.exec(outer ? 'COMMIT' : `RELEASE SAVEPOINT zt${depth}`);
        return out;
      } catch (e) {
        depth--;
        raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT zt${depth}; RELEASE SAVEPOINT zt${depth}`);
        throw e;
      }
    },
    close: () => raw.close(),
  };
}

/** better-sqlite3 rejects `undefined` the same way; normalise both drivers to the same input. */
function normalise(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/**
 * @param {string} file
 * @returns {{db:object, driver:string}}
 */
function open(file) {
  const Better = betterDriver();
  if (Better) return { db: new Better.Driver(file), driver: Better.kind };
  return { db: nodeSqliteDriver(file), driver: 'node:sqlite (shim)' };
}

module.exports = { open, nodeSqliteDriver, betterDriver };
