/** Test harness: the REAL Hono Worker app against an isolated in-memory D1-compatible DB. */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openLocalDatabase, type DatabaseSync } from '../apps/worker/src/db.js';
import { createApp } from '../apps/worker/src/app.js';
import type { AppEnv } from '../apps/worker/src/context.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export interface Harness {
  app: ReturnType<typeof createApp>;
  env: AppEnv;
  sqlite: DatabaseSync;
  call(method: string, url: string, body?: unknown, opts?: { cookie?: string; csrf?: string; ip?: string; bearer?: boolean }): Promise<{ status: number; json: any; headers: Headers }>;
  setupToken: string;
  session: { cookie: string; csrf: string } | null;
  /** The session `setup()` created. Suites that log in as another role must hand it back with
   *  asOwner() or every later request in the file runs with that role's permissions. */
  asOwner(): void;
  token(): string;
  setup(payload?: Record<string, unknown>): Promise<any>;
  login(username: string, password: string): Promise<any>;
}

export function makeHarness(): Harness {
  const sqlite = openLocalDatabase(':memory:');
  let ownerSession: { cookie: string; csrf: string } | null = null;
  for (const f of readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
  }
  const setupToken = 'test-setup-token-' + Math.random().toString(36).slice(2);
  const env: AppEnv = {
    DB: undefined as any,
    __ZT_SQLITE__: sqlite,
    __ZT_LOCAL_BACKUP_DIR__: path.join(ROOT, '.test-backups'),
    LOCAL_PREVIEW: '1',
    EXPOSE_SETUP_TOKEN: '1',
    SETUP_TOKEN: setupToken,
    SESSION_SECRET: 'test-session-secret-not-for-production',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  } as AppEnv;
  const app = createApp();
  const h: Harness = {
    app, env, sqlite, setupToken, session: null,
    token() {
      const m = /zt_session=([^;]+)/.exec(h.session?.cookie ?? '');
      if (!m) throw new Error('no session token — call setup() or login() first');
      return m[1];
    },
    async call(method, url, body, opts = {}) {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (opts.ip) headers.set('cf-connecting-ip', opts.ip);
      if (opts.bearer) {
        // Desktop path: token in the header, deliberately NO cookie and NO CSRF header, which is
        // exactly what an Electron main-process request over file:// looks like.
        headers.set('Authorization', `Bearer ${h.token()}`);
      } else {
        if (opts.cookie ?? h.session?.cookie) headers.set('Cookie', opts.cookie ?? h.session!.cookie);
        if (opts.csrf ?? h.session?.csrf) headers.set('x-csrf-token', opts.csrf ?? h.session!.csrf);
      }
      const req = new Request(`https://zt.test${url}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const res = await app.fetch(req, env);
      let json: any = null;
      const text = await res.text();
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, json, headers: res.headers };
    },
    async setup(payload = {}) {
      const res = await h.call('POST', '/api/v1/setup', {
        setup_token: setupToken,
        owner: { name: 'Test Owner', username: 'owner', mobile: '0307-7864722', password: 'correct-horse-battery-123' },
        maund_kg: 40, maund_confirmed: true,
        opening_balances: [
          { account_code: 'CASH', amount_paisa: 10000000, as_of_date: '2026-07-01', direction: 'DEBIT' },
        ],
        ...payload,
      });
      if (res.status !== 201) throw new Error(`setup failed ${res.status}: ${JSON.stringify(res.json)}`);
      h.session = { cookie: extractCookie(res.headers), csrf: res.json.data.csrf };
      ownerSession = h.session;
      return res.json.data;
    },
    asOwner() { h.session = ownerSession; },
    async login(username, password) {
      const res = await h.call('POST', '/api/v1/auth/login', { username, password }, { cookie: '', csrf: '' });
      if (res.status !== 200) throw new Error(`login failed ${res.status}: ${JSON.stringify(res.json)}`);
      h.session = { cookie: extractCookie(res.headers), csrf: res.json.data.csrf };
      return res.json.data;
    },
  };
  return h;
}

function extractCookie(headers: Headers): string {
  const all = (headers as any).getSetCookie?.() as string[] | undefined;
  const parts = all ?? [headers.get('set-cookie') ?? ''];
  const out: string[] = [];
  for (const line of parts) {
    for (const bit of line.split(/,(?=\s*zt_)/)) {
      const m = /^\s*(zt_(?:session|csrf|expires))=([^;]+)/.exec(bit);
      if (m && m[1] !== 'zt_expires' && m[1] !== 'zt_csrf') out.push(`${m[1]}=${m[2]}`);
    }
  }
  return out.join('; ');
}

export const TODAY = '2026-11-03';

export async function createProduct(h: Harness, overrides: Record<string, unknown> = {}) {
  const res = await h.call('POST', '/api/v1/products', {
    name_ur: 'ڈی اے پی کھاد', name_en: 'DAP Fertilizer', category_id: 'cat-fert',
    sku: 'DAP-' + Math.random().toString(36).slice(2, 8),
    base_unit: 'bag', purchase_unit: 'bag', sale_unit: 'bag',
    conversion_ratio_milli: 1000, grams_per_base_unit: 50000,
    purchase_rate_paisa: 250000, sale_rate_paisa: 300000,
    reorder_level_milli: 10000, show_public_price: true, public_price_paisa: 300000,
    is_published: false, is_active: true, description_ur: '<b>مصنوعات</b>',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`product failed ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json.data as { id: string; slug: string };
}

export function money(rupees: number): number { return Math.round(rupees * 100); }
