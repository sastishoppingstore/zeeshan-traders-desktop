/**
 * LOCAL PREVIEW / integration-test server.
 * Runs the EXACT same Hono Worker app against a persistent node:sqlite database.
 * One port serves both the built React app and /api/v1, so browser code uses relative URLs.
 * Not used on Cloudflare (there, index.ts + wrangler.jsonc are the entry point).
 */
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openLocalDatabase } from '../db.js';
import { createApp } from '../app.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEV_DIR = path.join(ROOT, '.dev');
mkdirSync(DEV_DIR, { recursive: true });

const secretsPath = path.join(DEV_DIR, 'secrets.json');
type Secrets = { setup_token: string; session_secret: string; data_encryption_key: string; backup_encryption_key: string };
const b64 = () => randomBytes(32).toString('base64');
let secrets: Secrets;
if (existsSync(secretsPath)) secrets = JSON.parse(readFileSync(secretsPath, 'utf8')) as Secrets;
else {
  secrets = {
    setup_token: randomBytes(24).toString('hex'),
    session_secret: b64(), data_encryption_key: b64(), backup_encryption_key: b64(),
  };
  writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
}

const dbPath = process.env.ZT_DB ?? path.join(DEV_DIR, 'zt.db');
const sqlite = openLocalDatabase(dbPath);
for (const f of readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  sqlite.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
}

const env: any = {
  __ZT_SQLITE__: sqlite,
  __ZT_STATIC_DIR__: path.join(ROOT, 'apps', 'web', 'dist'),
  __ZT_LOCAL_BACKUP_DIR__: DEV_DIR,
  SETUP_TOKEN: secrets.setup_token,
  SESSION_SECRET: secrets.session_secret,
  DATA_ENCRYPTION_KEY: secrets.data_encryption_key,
  BACKUP_ENCRYPTION_KEY: secrets.backup_encryption_key,
  EXPOSE_SETUP_TOKEN: '1',
  LOCAL_PREVIEW: '1',
  // WebAuthn is domain-bound: local E2E uses localhost; production MUST set RP_ID/RP_ORIGIN
  // to the final domain BEFORE the owner enrols a fingerprint (Part 10.3).
  RP_ID: process.env.ZT_RP_ID ?? 'localhost',
  RP_ORIGIN: process.env.ZT_RP_ORIGIN ?? `http://localhost:${process.env.PORT ?? 3000}`,
  RP_NAME: 'ذیشان ٹریڈرز',
};

const app = createApp();
const port = Number(process.env.PORT ?? 3000);
const hostname = '0.0.0.0';

console.log('===================================================================');
console.log(' ذیشان ٹریڈرز — LOCAL PREVIEW (online + offline capable)');
console.log('===================================================================');
console.log(` URL          : http://${hostname}:${port}/  (public)  /erp (ERP)`);
console.log(` Database     : ${dbPath}  (persistent node:sqlite, same D1 schema)`);
console.log(` SETUP TOKEN  : ${secrets.setup_token}`);
console.log(' (one-time, printed here on first start; stored in .dev/secrets.json).');
console.log(' Production uses `wrangler secret put SETUP_TOKEN` and NEVER exposes it.');
console.log('===================================================================');

serve({ fetch: (request: Request) => app.fetch(request, env), hostname, port });
