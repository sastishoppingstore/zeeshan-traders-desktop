/**
 * Restore an encrypted Zeeshan Traders backup into a STAGING database.
 *
 * Format produced by runBackup(): NDJSON lines {"table":...,"row":{...}} -> gzip -> AES-GCM,
 * with a 12-byte random IV prepended to the ciphertext.
 *
 * SAFETY: this script refuses to run without --i-know-this-is-staging, refuses a target
 * path containing "production", and never writes to the live preview DB by accident.
 * A backup is only "valid" after this restore passes on staging (see docs/RUNBOOK.md).
 *
 * Usage:
 *   npx tsx scripts/restore.ts --file .dev/backups/<id>.ztbak --target .dev/restore-test.db \
 *     --key "$BACKUP_ENCRYPTION_KEY" --i-know-this-is-staging
 *   npx tsx scripts/restore.ts --file ... --verify-only --key "$BACKUP_ENCRYPTION_KEY"
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { openLocalDatabase } from '../apps/worker/src/db.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function importKey(secret: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try { raw = Uint8Array.from(atob(secret), (ch) => ch.charCodeAt(0)); }
  catch { raw = new TextEncoder().encode(secret); }
  if (raw.length !== 32) raw = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
}

function normalise(v: unknown): string | number | null | Uint8Array {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

async function main() {
  const file = arg('--file');
  const keySecret = arg('--key') ?? process.env.BACKUP_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  const verifyOnly = has('--verify-only');
  const target = arg('--target');
  if (!file) throw new Error('missing --file <backup.ztbak>');
  if (!existsSync(file)) throw new Error(`backup file not found: ${file}`);
  if (!keySecret) throw new Error('missing --key or BACKUP_ENCRYPTION_KEY env var');
  if (!verifyOnly) {
    if (!has('--i-know-this-is-staging')) throw new Error('refusing to restore without --i-know-this-is-staging');
    if (!target) throw new Error('missing --target <staging sqlite path>');
    if (/production|prod/i.test(target)) throw new Error('refusing to restore into a path containing "production"');
    if (path.resolve(target) === path.resolve(path.join(ROOT, '.dev', 'zt.db')))
      throw new Error('refusing to overwrite the live preview database');
  }

  const payload = new Uint8Array(readFileSync(file));
  if (payload.byteLength < 29) throw new Error('backup too short / corrupt');
  const iv = payload.slice(0, 12);
  const cipher = payload.slice(12);
  const key = await importKey(keySecret);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource));
  } catch (e) {
    throw new Error(`AES-GCM decrypt FAILED — wrong key or corrupt backup: ${String(e)}`);
  }
  // gzip magic 1f 8b; otherwise the producer fell back to plain NDJSON.
  let ndjson: string;
  if (plain[0] === 0x1f && plain[1] === 0x8b) ndjson = gunzipSync(Buffer.from(plain)).toString('utf8');
  else ndjson = new TextDecoder().decode(plain);

  const entries: { table: string; row: Record<string, unknown> }[] = [];
  const tables = new Set<string>();
  for (const [i, line] of ndjson.split('\n').entries()) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { throw new Error(`invalid NDJSON on line ${i + 1}`); }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(o.table))) throw new Error(`unsafe table name on line ${i + 1}: ${o.table}`);
    if (!o.row || typeof o.row !== 'object') throw new Error(`invalid row on line ${i + 1}`);
    entries.push(o); tables.add(o.table);
  }
  if (!entries.length) throw new Error('backup contains zero rows — refusing to call this valid');
  console.log(`DECRYPT OK: ${payload.byteLength} bytes -> ${ndjson.length} bytes NDJSON, ${entries.length} rows, ${tables.size} tables`);
  if (verifyOnly) { console.log('VERIFY-ONLY: decrypt + parse OK (no database written)'); return; }

  mkdirSync(path.dirname(target!), { recursive: true });
  const db: DatabaseSync = openLocalDatabase(target!);
  for (const f of readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort())
    db.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));

  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN');
  try {
    for (const t of tables) db.exec(`DELETE FROM "${t}"`);
    for (const e of entries) {
      const keys = Object.keys(e.row);
      if (!keys.length) continue;
      if (keys.some((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) throw new Error(`unsafe column name in ${e.table}`);
      const sql = `INSERT OR REPLACE INTO "${e.table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
      db.prepare(sql).run(...keys.map((k) => normalise(e.row[k])));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA foreign_keys=ON');

  const fk = db.prepare('PRAGMA foreign_key_check').all() as any[];
  if (fk.length) throw new Error(`foreign_key_check FAILED: ${JSON.stringify(fk.slice(0, 5))}`);
  const journal = db.prepare(`SELECT COALESCE(SUM(debit_paisa),0) d, COALESCE(SUM(credit_paisa),0) c FROM journal_lines`).get() as any;
  const tableCount = (db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get() as any).n;
  const result = {
    restored_rows: entries.length, restored_tables: tables.size, database_tables: tableCount,
    foreign_key_check: 'PASS', journal_balanced: journal.d === journal.c,
    debit_paisa: journal.d, credit_paisa: journal.c, at: new Date().toISOString(),
  };
  if (!result.journal_balanced) throw new Error(`H4 FAILED after restore: ${JSON.stringify(result)}`);
  console.log('RESTORE + INTEGRITY PASS:', JSON.stringify(result, null, 2));
  writeFileSync(`${target}.restore-result.json`, JSON.stringify(result, null, 2));
  console.log(`staging_restore_result written to ${target}.restore-result.json — copy this evidence into docs/TEST_REPORT.md`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('RESTORE FAILED:', e instanceof Error ? e.message : e); process.exit(1); });
