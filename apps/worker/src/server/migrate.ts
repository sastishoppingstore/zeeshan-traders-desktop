/** Apply numbered migrations to the local SQLite file (mirrors `wrangler d1 migrations apply`). */
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openLocalDatabase } from '../db.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const target = process.env.ZT_DB ?? path.join(ROOT, '.dev', 'zt.db');
mkdirSync(path.dirname(target), { recursive: true });
const db = openLocalDatabase(target);
const files = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  db.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
  console.log(`applied migrations/${f}`);
}
const tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get() as { n: number };
console.log(`OK — ${tables.n} tables in ${target}`);
