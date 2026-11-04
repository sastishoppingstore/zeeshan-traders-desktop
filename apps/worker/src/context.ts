/** Hono app bindings, auth/RBAC/CSRF middleware, settings, sequences, errors, cache, audit. */
import type { Context, MiddlewareHandler } from 'hono';
import type { D1DatabaseLike, DB, R2BucketLike } from './db.js';
import { D1DB, LocalDB } from './db.js';
import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';
import { sha256, ulid, karachiNowIso, karachiToday, encryptText, seqNumber } from '@zt/shared';
export { seqNumber };
import { BUSINESS_PROFILE, PERMISSIONS } from '@zt/shared';
import type { ApiError, SessionUser } from '@zt/shared';
export { karachiToday };

export interface AppEnv {
  DB: D1DatabaseLike;
  FILES?: R2BucketLike;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SESSION_SECRET?: string;
  DATA_ENCRYPTION_KEY?: string;
  BACKUP_ENCRYPTION_KEY?: string;
  SETUP_TOKEN?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITEKEY?: string;
  TURNSTILE_VERIFY_URL?: string;
  RP_ID?: string;
  RP_ORIGIN?: string;
  RP_NAME?: string;
  /** Test-only injection so the Turnstile gate can be verified without Cloudflare network access. */
  __ZT_TURNSTILE_VERIFY__?: (token: string, ip: string) => Promise<boolean>;
  EXPOSE_SETUP_TOKEN?: string;
  LOCAL_PREVIEW?: string;
  __ZT_SQLITE__?: DatabaseSync;
  __ZT_LOCAL_BACKUP_DIR__?: string;
}

export interface AppVars {
  db: DB;
  user?: SessionUser;
  session_id?: string;
}

export type AppContext = Context<{ Bindings: AppEnv; Variables: AppVars }>;
export type AppMiddleware = MiddlewareHandler<{ Bindings: AppEnv; Variables: AppVars }>;

export function makeDb(env: AppEnv): DB {
  if (env.__ZT_SQLITE__) return new LocalDB(env.__ZT_SQLITE__);
  return new D1DB(env.DB);
}

export const nowIso = karachiNowIso;
export const today = karachiToday;

export function ok<T>(c: AppContext, data: T, status = 200) {
  return c.json({ ok: true, data }, status as any);
}

export function fail(c: AppContext, status: number, code: string, message_ur: string, message_en: string, field_errors?: Record<string, string>) {
  const error: ApiError = { code, message_ur, message_en, ...(field_errors ? { field_errors } : {}) };
  return c.json({ ok: false, error }, status as any);
}

export function fieldErrors(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of e.issues) out[issue.path.join('.') || '_'] = issue.message;
  return out;
}

export function badRequest(c: AppContext, e: ZodError) {
  return fail(c, 400, 'VALIDATION_ERROR', 'درج کردہ معلومات درست نہیں ہیں', 'Validation failed', fieldErrors(e));
}

export function serverError(c: AppContext, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[ZT ERROR]', msg, e instanceof Error ? e.stack : '');
  return fail(c, 500, 'INTERNAL_ERROR', `سرور خرابی: ${msg}`, `Server error: ${msg}`);
}

/** Business errors thrown by services, mapped to a consistent API error shape. */
export class BizError extends Error {
  constructor(
    public status: number,
    public code: string,
    public ur: string,
    public en: string,
    public fields?: Record<string, string>,
  ) { super(en); }
}

export function handle(c: AppContext, fn: () => Promise<Response> | Response): Promise<Response> | Response {
  try {
    const r = fn();
    if (r instanceof Promise) return r.catch((e) => mapError(c, e));
    return r;
  } catch (e) { return mapError(c, e); }
}

export function mapError(c: AppContext, e: unknown): Response {
  if (e instanceof BizError) return fail(c, e.status, e.code, e.ur, e.en, e.fields);
  if (e instanceof ZodError) return badRequest(c, e);
  return serverError(c, e);
}

// ---------------------------------- Settings ---------------------------------
export async function getSetting<T = unknown>(db: DB, key: string): Promise<T | undefined> {
  const row = await db.prepare('SELECT value FROM business_settings WHERE key = ?').first<{ value: string }>(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value) as T; } catch { return row.value as unknown as T; }
}

export async function setSetting(db: DB, key: string, value: unknown, userId: string | null): Promise<void> {
  await db.prepare(`INSERT INTO business_settings (key,value,updated_at,updated_by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .bind(key, JSON.stringify(value), nowIso(), userId).run();
}

export async function businessInfo(db: DB) {
  const stored = await getSetting<any>(db, 'business');
  const footer = (await getSetting<string>(db, 'invoice_footer')) ?? '';
  const logo = (await getSetting<string>(db, 'logo_r2_key')) ?? '';
  const pestLic = (await getSetting<string>(db, 'pesticide_licence_no')) ?? '';
  const pestExp = (await getSetting<string>(db, 'pesticide_licence_expiry')) ?? '';
  return {
    name_ur: stored?.name_ur ?? BUSINESS_PROFILE.name_ur,
    name_en: stored?.name_en ?? BUSINESS_PROFILE.name_en,
    location_ur: stored?.location_ur ?? BUSINESS_PROFILE.location_ur,
    location_en: stored?.location_en ?? BUSINESS_PROFILE.location_en,
    phone1: stored?.phone1 ?? BUSINESS_PROFILE.phone1,
    phone2: stored?.phone2 ?? BUSINESS_PROFILE.phone2,
    whatsapp1: stored?.whatsapp1 ?? BUSINESS_PROFILE.whatsapp1,
    whatsapp2: stored?.whatsapp2 ?? BUSINESS_PROFILE.whatsapp2,
    currency: 'PKR', timezone: BUSINESS_PROFILE.timezone,
    invoice_footer: footer, logo_r2_key: logo,
    pesticide_licence_no: pestLic, pesticide_licence_expiry: pestExp,
  };
}

// --------------------------------- Sequences ---------------------------------
/** Returns a candidate sequence value. The posting batch MUST include a conditional
 *  UPDATE ... WHERE next_value = candidate and verify changes===1, else retry. */
export async function nextValue(db: DB, code: string): Promise<{ prefix: string; value: number; number: string }> {
  const row = await db.prepare('SELECT prefix,next_value FROM invoice_sequences WHERE code = ?').first<{ prefix: string; next_value: number }>(code);
  if (!row) {
    await db.prepare('INSERT INTO invoice_sequences (code,prefix,next_value,updated_at) VALUES (?,?,1,?)')
      .bind(code, code.slice(0, 2).toUpperCase(), nowIso()).run();
    return { prefix: code.slice(0, 2).toUpperCase(), value: 1, number: seqNumber(code.slice(0, 2).toUpperCase(), 1) };
  }
  return { prefix: row.prefix, value: row.next_value, number: seqNumber(row.prefix, row.next_value) };
}
// ----------------------------------- Audit -----------------------------------
export async function audit(db: DB, action: string, entity: string, entity_id: string | null, opts: {
  user_id?: string | null; before?: unknown; after?: unknown; reason?: string; ip?: string;
} = {}): Promise<void> {
  await db.prepare(`INSERT INTO audit_logs (id,at,user_id,action,entity,entity_id,before_json,after_json,reason,ip,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      ulid(), nowIso(), opts.user_id ?? null, action, entity, entity_id,
      opts.before === undefined ? null : JSON.stringify(opts.before),
      opts.after === undefined ? null : JSON.stringify(opts.after),
      opts.reason ?? null, opts.ip ?? null, nowIso(),
    ).run();
}

// --------------------------------- Sessions ----------------------------------
export function cookieValue(c: AppContext, name: string): string | null {
  const raw = c.req.header('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function clientIp(c: AppContext): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** HttpOnly Secure SameSite=Lax session cookie + readable CSRF cookie. */
export function sessionCookies(c: AppContext, token: string, csrf: string, expires: string): string[] {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  return [
    `zt_session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=1209600`,
    `zt_csrf=${csrf}${secure}; SameSite=Lax; Path=/; Max-Age=1209600`,
    `zt_expires=${expires}${secure}; SameSite=Lax; Path=/; Max-Age=1209600`,
  ];
}

export async function createSession(db: DB, userId: string, deviceId: string | null, ip: string) {
  const token = (await sha256(`${ulid()}:${crypto.randomUUID()}`)) + crypto.randomUUID().replace(/-/g, '');
  const csrf = crypto.randomUUID().replace(/-/g, '');
  const hash = await sha256(token);
  const at = nowIso();
  const expires = new Date(Date.now() + 14 * 86400_000).toISOString();
  await db.prepare(`INSERT INTO sessions (id,user_id,token_hash,csrf,device_id,ip,created_at,expires_at,last_seen,revoked_at)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`)
    .bind(ulid(), userId, hash, csrf, deviceId, ip, at, expires, at).run();
  if (deviceId) {
    await db.prepare(`INSERT INTO devices (id,user_id,name,registered_at) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET last_sync_at=excluded.registered_at`)
      .bind(deviceId, userId, 'browser', at).run();
  }
  return { token, csrf, expires };
}

export async function resolveSession(db: DB, token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const hash = await sha256(token);
  const s = await db.prepare(`SELECT id,user_id,csrf,device_id,expires_at,revoked_at FROM sessions WHERE token_hash = ?`).first<any>(hash);
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() < Date.now()) return null;
  const u = await db.prepare(`SELECT id,username,display_name,status FROM users WHERE id = ?`).first<any>(s.user_id);
  if (!u || u.status !== 'ACTIVE') return null;
  const roles = await db.prepare(`SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?`).bind(s.user_id).all<{ code: string }>();
  const codes = roles.map((r) => r.code);
  const placeholders = codes.length ? codes.map(() => '?').join(',') : `''`;
  const perms = codes.length
    ? await db.prepare(`SELECT DISTINCT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code IN (${placeholders})`).bind(...codes).all<{ permission_code: string }>()
    : [];
  if (roles.some((r) => r.code === 'OWNER')) perms.push(...PERMISSIONS.map((p) => ({ permission_code: p })));
  return {
    id: u.id, username: u.username, name: u.display_name,
    roles: roles.map((r) => r.code),
    permissions: [...new Set(perms.map((p) => p.permission_code))],
    device_id: s.device_id ?? undefined, csrf: s.csrf,
  };
}

/** Deny-by-default auth + CSRF middleware for /api/v1/* (public routes excluded by the caller). */
export const requireAuth: AppMiddleware = async (c, next) => {
  const db = c.get('db')!;
  const user = await resolveSession(db, cookieValue(c, 'zt_session'));
  if (!user) return fail(c, 401, 'UNAUTHENTICATED', 'براہِ کرم دوبارہ لاگ ان کریں', 'Please log in again');
  const method = c.req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const header = c.req.header('x-csrf-token');
    if (!header || header !== user.csrf) return fail(c, 403, 'CSRF_FAILED', 'سیکیورٹی ٹوکن غائب یا غلط ہے', 'CSRF token missing or invalid');
  }
  const device = user.device_id;
  if (device) {
    const d = await db.prepare('SELECT revoked_at FROM devices WHERE id=?').first<{ revoked_at: string | null }>(device);
    if (d?.revoked_at) return fail(c, 403, 'DEVICE_REVOKED', 'یہ ڈیوائس بند کر دی گئی ہے', 'This device has been revoked');
  }
  c.set('user', user);
  await db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').bind(nowIso(), await sha256(cookieValue(c, 'zt_session')!)).run();
  await next();
};

export function requirePerm(permission: string): AppMiddleware {
  return async (c, next) => {
    const u = c.get('user');
    if (!u) return fail(c, 401, 'UNAUTHENTICATED', 'لاگ ان ضروری ہے', 'Login required');
    if (!u.permissions.includes('*') && !u.permissions.includes(permission)) {
      return fail(c, 403, 'PERMISSION_DENIED', 'آپ کو اس کام کی اجازت نہیں ہے', `Permission denied: ${permission}`);
    }
    await next();
  };
}

export const me = (c: AppContext): SessionUser => {
  const u = c.get('user');
  if (!u) throw new BizError(401, 'UNAUTHENTICATED', 'لاگ ان ضروری ہے', 'Login required');
  return u;
};

// ------------------------------- Rate limiting ------------------------------
export async function rateLimit(db: DB, key: string, max: number, windowMs: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / windowMs).toString();
  const k = `${key}:${bucket}`;
  const row = await db.prepare('SELECT count FROM rate_limits WHERE key=? AND window_start=?').first<{ count: number }>(k, bucket);
  if (row && row.count >= max) return false;
  await db.prepare(`INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1)
    ON CONFLICT(key,window_start) DO UPDATE SET count=count+1`).bind(k, bucket).run();
  return true;
}

// -------------------------------- Period lock -------------------------------
export async function assertPeriodOpen(db: DB, date: string): Promise<void> {
  const ym = date.slice(0, 7);
  const row = await db.prepare('SELECT ym FROM accounting_periods WHERE ym=?').first(ym);
  if (row) throw new BizError(409, 'PERIOD_CLOSED', 'یہ مالی مدت بند ہے؛ درستی صرف کھلی مدت میں مالک کی منظوری سے ہوگی', 'Accounting period is closed');
}

// -------------------------------- Idempotency -------------------------------
export async function idempotentResult(db: DB, key?: string): Promise<{ id: string; number: string } | null> {
  if (!key) return null;
  const row = await db.prepare('SELECT server_doc_id,server_number,status FROM sync_operations WHERE idempotency_key=?').first<any>(key);
  if (row?.server_doc_id && row.status === 'SYNCED') return { id: row.server_doc_id, number: row.server_number ?? '' };
  return null;
}

// --------------------------------- CNIC --------------------------------------
export async function encryptCnic(c: AppContext, cnic?: string): Promise<string | null> {
  if (!cnic) return null;
  const secret = c.env.DATA_ENCRYPTION_KEY ?? c.env.SESSION_SECRET ?? 'local-preview-data-key';
  return encryptText(cnic, secret);
}

// ---------------------------------- Cache -----------------------------------
const memoryCache = new Map<string, { expires: number; body: string }>();
/** Every key written in this isolate, so purge works on the edge Cache API too (which has no prefix delete). */
const knownCacheKeys = new Set<string>();
/** Bumped on every publish/unpublish: old keys can never be served again, even from a stale isolate. */
let cacheGeneration = 0;
const cacheUrl = (full: string) => `https://zt-cache.invalid/${encodeURIComponent(full)}`;
const fullKey = (key: string) => `zt-public:v${cacheGeneration}:${key}`;

export async function cacheRead(c: AppContext, key: string): Promise<string | null> {
  const full = fullKey(key);
  const cache = (globalThis as any).caches?.default;
  if (cache) {
    const res = await cache.match(new Request(cacheUrl(full)));
    if (res) return res.text();
    return null;
  }
  const hit = memoryCache.get(full);
  if (hit && hit.expires > Date.now()) return hit.body;
  memoryCache.delete(full);
  return null;
}
export async function cacheWrite(c: AppContext, key: string, body: string, ttlSeconds: number): Promise<void> {
  const full = fullKey(key);
  knownCacheKeys.add(full);
  const cache = (globalThis as any).caches?.default;
  if (cache) {
    await cache.put(
      new Request(cacheUrl(full)),
      new Response(body, { headers: { 'Cache-Control': `public, max-age=${ttlSeconds}`, 'Content-Type': 'application/json' } }),
    );
    return;
  }
  memoryCache.set(full, { expires: Date.now() + ttlSeconds * 1000, body });
}
/** Invalidate ALL public catalogue/CMS cache entries after any publish/unpublish/CMS change. */
export async function purgePublicCache(): Promise<void> {
  const cache = (globalThis as any).caches?.default;
  if (cache) {
    for (const full of knownCacheKeys) {
      try { await cache.delete(new Request(cacheUrl(full))); } catch { /* best effort per key */ }
    }
  }
  memoryCache.clear();
  knownCacheKeys.clear();
  cacheGeneration += 1; // logical invalidation: old keys cannot be re-read even by another isolate
}

/** Optional Cloudflare Turnstile verification for the public enquiry form (Part 2.3 / 8.2).
 *  When TURNSTILE_SECRET is absent the feature is off and honeypot + time-trap still apply.
 *  Tests inject __ZT_TURNSTILE_VERIFY__ because this sandbox cannot reach Cloudflare's API. */
export async function verifyTurnstile(c: AppContext, token: string): Promise<boolean> {
  if (!c.env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  if (c.env.__ZT_TURNSTILE_VERIFY__) return c.env.__ZT_TURNSTILE_VERIFY__(token, clientIp(c));
  const url = c.env.TURNSTILE_VERIFY_URL ?? 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: c.env.TURNSTILE_SECRET, response: token, remoteip: clientIp(c) }),
    });
    const json = await res.json() as { success?: boolean };
    return json?.success === true;
  } catch { return false; }
}

// --------------------------------- Pagination -------------------------------
export function keyset(cursor?: string, limit = 25): { sql: string; args: (string | number)[] } {
  const lim = Math.min(Math.max(limit, 1), 100);
  if (!cursor) return { sql: ' LIMIT ?', args: [lim] };
  const [ts, id] = cursor.split('|');
  return { sql: ' AND (created_at < ? OR (created_at = ? AND id < ?)) LIMIT ?', args: [ts, ts, id, lim] };
}

export function csvEscape(x: unknown): string {
  const s = x === null || x === undefined ? '' : String(x);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return '';
  const cols = columns ?? Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n');
}
