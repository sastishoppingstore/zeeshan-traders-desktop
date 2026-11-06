#!/usr/bin/env node
/**
 * Dev-only: snapshot migrations/*.sql into electron/migrations.generated.cjs.
 *
 * A packaged app normally gets the real files through electron-builder `extraResources`, but that is
 * configuration owned by another package.json; if the folder is missing from the installer, the app
 * must still be able to build its local schema. This snapshot is that fallback. It stores the files
 * verbatim — sanitising stays in sql-statements.cjs so there is only one filter, never two.
 *
 *   node electron/gen-migrations.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const DIR = path.join(REPO, 'migrations');
const OUT = path.join(__dirname, 'migrations.generated.cjs');

const names = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
if (!names.length) {
  process.stderr.write(`gen-migrations: no .sql files under ${DIR} — refusing to write an empty snapshot.\n`);
  process.exit(2);
}

const sql = {};
for (const name of names) sql[name] = fs.readFileSync(path.join(DIR, name), 'utf8');
const hash = crypto.createHash('sha256');
for (const name of names) hash.update(name).update('\0').update(sql[name]);

const body = `/**
 * Snapshot of migrations/*.sql for packaged builds without a migrations/ resource folder.
 * GENERATED, DO NOT EDIT — regenerate with \`node electron/gen-migrations.cjs\` after any migration.
 *
 *   files  ${names.length}
 *   sha256 ${hash.digest('hex').slice(0, 16)}
 *
 * Content is byte-identical to the source files; the Cloudflare-internal filter is applied at
 * runtime by electron/sql-statements.cjs, so this file is a transport, not a transformed schema.
 */
'use strict';

const ORDER = ${JSON.stringify(names, null, 2)};

const SQL = ${JSON.stringify(sql, null, 2)};

module.exports = { ORDER, SQL, SHA256: ${JSON.stringify(hash.digest('hex'))} };
`;

fs.writeFileSync(OUT, body, 'utf8');
process.stdout.write(`wrote electron/migrations.generated.cjs (${names.length} files, ${body.length} bytes)\n`);
