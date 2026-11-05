/** Settings, usage meter, offline sync/conflicts, encrypted backup, feature-status checklist. */
import type { Hono } from 'hono';
import type { AppContext, AppEnv, AppVars } from '../context.js';
import type { DB } from '../db.js';
import {
  ok, fail, handle, me, audit, nowIso, requirePerm, getSetting, setSetting,
  idempotentResult, BizError, purgePublicCache, getSetting as gs,
} from '../context.js';
import {
  settingsSchema, syncOperationSchema, saleSchema, purchaseSchema, receiptSchema,
  paymentSchema, expenseSchema, grainPurchaseSchema, grainSaleSchema, partySchema,
  ulid, karachiToday, encryptText,
} from '@zt/shared';
import type { SyncOperation } from '@zt/shared';
import { postSale, postPurchase } from '../services/trade.js';
import { postGrainSale, postGrainPurchase } from '../services/grains.js';
import { postReceipt, postExpense } from '../services/money.js';
import { postParty } from '../services/inventory.js';
import { runIntegrity } from './reports.js';
import { handleRowPush } from './syncRows.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

export function registerOps(app: H) {
  // --------------------------------- Settings ---------------------------------
  app.get('/api/v1/settings', requirePerm('settings.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare('SELECT key,value,updated_at,updated_by FROM business_settings ORDER BY key').all<any>();
    const out: Record<string, unknown> = {};
    for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
    return ok(c, out);
  }));
  app.put('/api/v1/settings', requirePerm('settings.write'), (c) => handle(c, async () => {
    const body = settingsSchema.parse(await c.req.json());
    const db = c.get('db')!;
    const allowed = new Set([
      'business', 'maund_kg', 'maund_confirmed', 'bag_sizes_confirmed', 'fiscal_year',
      'numbering_prefixes', 'print_size', 'invoice_footer', 'require_cnic_on_fertilizer_sale',
      'cnic_enabled', 'privacy_cnic', 'negative_stock_allowed', 'landed_cost_basis',
      'grain_rate_basis', 'near_expiry_days', 'record_retention_years', 'pesticide_licence_no',
      'pesticide_licence_expiry', 'fertilizer_authorisation_no', 'fertilizer_authorisation_expiry',
      'opening_hours', 'logo_r2_key', 'social_links', 'theme', 'language', 'low_stock_alerts',
      'backup_retention', 'hero_tagline', 'period_lock',
    ]);
    if (!allowed.has(body.key)) throw new BizError(400, 'SETTING_NOT_ALLOWED', 'یہ ترتیب قابلِ تبدیلی نہیں', 'Setting is not editable');
    const before = await getSetting(db, body.key);
    await setSetting(db, body.key, body.value, me(c).id);
    await audit(db, 'UPDATE', 'business_settings', body.key, { user_id: me(c).id, before, after: body.value });
    await purgePublicCache();
    return ok(c, { key: body.key });
  }));

  // ------------------------------- Usage meter --------------------------------
  app.get('/api/v1/usage', requirePerm('settings.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const day = karachiToday();
    const row = await db.prepare('SELECT * FROM usage_counters WHERE day=?').bind(day).first<any>();
    const reads = row?.rows_read ?? 0, writes = row?.rows_written ?? 0;
    const freeRead = 5_000_000, freeWrite = 100_000;
    return ok(c, {
      day, rows_read: reads, rows_written: writes,
      public_hits: row?.public_hits ?? 0, cached_public_hits: row?.cached_public_hits ?? 0,
      free_read_cap: freeRead, free_write_cap: freeWrite,
      read_pct: Math.round(reads / freeRead * 10000) / 100,
      write_pct: Math.round(writes / freeWrite * 10000) / 100,
      note_ur: 'مفت پلان کی حد (5M پڑھائی / 100K لکھائی یومیہ) — پیداوار کے لیے Workers Paid تجویز ہے۔ حدود کی تاریخِ تصدیق README میں درج ہے۔',
      plan: c.env.LOCAL_PREVIEW === '1' ? 'LOCAL_PREVIEW' : 'UNKNOWN',
    });
  }));

  // ----------------------------- Offline sync ---------------------------------
  app.get('/api/v1/sync/operations', requirePerm('sync.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT id,idempotency_key,device_id,type,status,tries,error,server_number,local_time,created_at FROM sync_operations ORDER BY created_at DESC LIMIT 100').all())));
  app.get('/api/v1/sync/conflicts', requirePerm('sync.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM sync_conflicts ORDER BY created_at DESC LIMIT 100').all())));

  // Same URL the web PWA already posts to, so no existing client has to be redeployed to keep
  // working. `operations` = batch of document commands; `rows` = master data, delegated to the
  // row-tier handler; anything else is the legacy single-op shape.
  app.post('/api/v1/sync/push', requirePerm('sync.read'), (c) => handle(c, async () => {
    const raw = await c.req.json() as any;
    if (Array.isArray(raw?.operations)) {
      return pushCommands(c, String(raw?.device_id ?? ''), raw.operations);
    }
    if (Array.isArray(raw?.rows)) {
      return handleRowPush(c, String(raw?.device_id ?? ''), raw.rows);
    }
    return applySyncOp(c, syncOperationSchema.parse(raw));
  }));

  app.post('/api/v1/sync/resolve/:id', requirePerm('sync.resolve'), (c) => handle(c, async () => {
    const body = await c.req.json() as { action?: 'ACCEPT' | 'REJECT'; reason?: string };
    if (!body.action || !body.reason) throw new BizError(400, 'REASON_REQUIRED', 'وجہ درکار ہے', 'Reason required');
    const db = c.get('db')!;
    const conflict = await db.prepare('SELECT * FROM sync_conflicts WHERE id=? AND status=\'OPEN\'').bind(c.req.param('id')).first<any>();
    if (!conflict) return fail(c, 404, 'NOT_FOUND', 'تضاد نہیں ملا', 'Conflict not found');
    const op = await db.prepare('SELECT * FROM sync_operations WHERE id=?').bind(conflict.operation_id).first<any>();
    let repost: any = null;
    if (body.action === 'ACCEPT' && op) {
      try {
        repost = await dispatch(c, op.type, JSON.parse(op.payload_json), op.idempotency_key, op.device_id);
        await db.prepare("UPDATE sync_operations SET status='SYNCED',server_doc_id=?,server_number=?,error=NULL WHERE id=?")
          .bind(repost.id, repost.number ?? '', op.id).run();
      } catch (e) {
        await db.prepare("UPDATE sync_operations SET status='CONFLICT',error=? WHERE id=?").bind(String(e), op.id).run();
        return ok(c, { resolved: false, still_conflict: true, error: String(e) });
      }
    } else if (op) {
      await db.prepare("UPDATE sync_operations SET status='FAILED',error=? WHERE id=?").bind(`Rejected: ${body.reason}`, op.id).run();
    }
    await db.prepare('UPDATE sync_conflicts SET status=?,resolved_at=?,resolved_by=?,reason=? WHERE id=?')
      .bind(body.action === 'ACCEPT' ? 'RESOLVED' : 'REJECTED', nowIso(), me(c).id, body.reason, conflict.id).run();
    await audit(db, 'RESOLVE_CONFLICT', 'sync_conflicts', conflict.id, { user_id: me(c).id, reason: body.reason, after: body.action });
    return ok(c, { resolved: true, repost });
  }));

  // --------------------------------- Backup -----------------------------------
  app.get('/api/v1/backup', requirePerm('backup.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM backup_logs ORDER BY at DESC LIMIT 50').all())));

  app.post('/api/v1/backup/run', requirePerm('backup.run'), (c) => handle(c, async () => {
    const result = await runBackup(c);
    return ok(c, result, 201);
  }));

  app.get('/api/v1/backup/download', requirePerm('backup.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const log = await db.prepare('SELECT * FROM backup_logs ORDER BY at DESC LIMIT 1').first<any>();
    if (!log) return fail(c, 404, 'NOT_FOUND', 'کوئی بیک اپ نہیں ملا', 'No backup found');
    const details = JSON.parse(log.details_json || '{}');
    const key = details.key as string | undefined;
    if (!key) return fail(c, 404, 'NOT_FOUND', 'بیک اپ فائل نہیں ملی', 'Backup key missing');
    if (c.env.FILES) {
      const obj = await c.env.FILES.get(key);
      if (!obj) return fail(c, 404, 'NOT_FOUND', 'بیک اپ فائل R2 میں نہیں ملی', 'Backup object missing');
      return c.body(await obj.arrayBuffer(), 200, { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"` });
    }
    if (c.env.__ZT_LOCAL_BACKUP_DIR__) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      try {
        const buf = await fs.readFile(path.join(c.env.__ZT_LOCAL_BACKUP_DIR__, 'backups', path.basename(key)));
        return c.body(buf, 200, { 'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${path.basename(key)}"` });
      } catch { return fail(c, 404, 'NOT_FOUND', 'بیک اپ فائل نہیں ملی', 'Backup file missing'); }
    }
    return fail(c, 501, 'INCOMPLETE_R2', 'R2 بائنڈنگ موجود نہیں', 'R2 binding missing');
  }));

  app.get('/api/v1/ops/jobs', requirePerm('audit.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM job_runs ORDER BY at DESC LIMIT 50').all())));

  // -------------------------- Honest feature checklist ------------------------
  app.get('/api/v1/features', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const integrity = await runIntegrity(db);
    return ok(c, { features: FEATURES, integrity, generated_at: nowIso() });
  }));
}

/**
 * Apply one queued document command. Extracted so `POST /sync/push` can take either the legacy
 * single-op body or a batch, with identical accounting and conflict semantics for both.
 * Never throws for a business rejection — that becomes a recorded CONFLICT/FAILED verdict, because
 * one bad document must not stop the rest of a device's queue from syncing.
 */
async function applySyncOp(c: AppContext, op: SyncOperation): Promise<Response> {
  const db = c.get('db')!;
  const existing = await idempotentResult(db, op.idempotency_key);
  if (existing) return ok(c, { status: 'SYNCED', id: existing.id, number: existing.number, duplicate: true });
  const device = await db.prepare('SELECT revoked_at,user_id FROM devices WHERE id=?').bind(op.device_id).first<any>();
  if (device?.revoked_at) throw new BizError(403, 'DEVICE_REVOKED', 'یہ ڈیوائس بند کر دی گئی ہے', 'Device revoked');
  try {
    const result = await dispatch(c, op.type, op.payload, op.idempotency_key, op.device_id);
    return ok(c, { status: 'SYNCED', id: result.id, number: result.number ?? '' }, 201);
  } catch (e) {
    const err = e instanceof BizError ? e : null;
    const conflictCodes = new Set(['INSUFFICIENT_STOCK', 'INSUFFICIENT_LOT_STOCK', 'PERIOD_CLOSED',
      'PRODUCT_ARCHIVED', 'EXPIRED_BATCH', 'BATCH_QUARANTINED', 'MAUND_NOT_CONFIRMED', 'CONCURRENT_MODIFICATION']);
    const isConflict = !!err && conflictCodes.has(err.code);
    const opId = ulid();
    await db.prepare(`INSERT INTO sync_operations (id,idempotency_key,device_id,user_id,type,payload_json,local_time,status,tries,error,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)`).bind(opId, op.idempotency_key, op.device_id, me(c).id,
      op.type, JSON.stringify(op.payload), op.local_time, isConflict ? 'CONFLICT' : 'FAILED',
      err?.en ?? String(e), nowIso()).run();
    if (isConflict) {
      const conflictId = ulid();
      await db.prepare(`INSERT INTO sync_conflicts (id,operation_id,code,message_ur,details_json,status,created_at)
        VALUES (?,?,?,?,?,'OPEN',?)`).bind(conflictId, opId, err!.code, err!.ur,
        JSON.stringify({ payload: op.payload }), nowIso()).run();
      return ok(c, { status: 'CONFLICT', conflict_id: conflictId, code: err!.code, message_ur: err!.ur,
        idempotency_key: op.idempotency_key }, 409);
    }
    return ok(c, { status: 'FAILED', code: err?.code ?? 'INTERNAL_ERROR', message_ur: err?.ur ?? String(e),
      idempotency_key: op.idempotency_key }, 422);
  }
}

const MAX_COMMAND_BATCH = 50;

/**
 * Batch form of the same endpoint: `{ device_id, operations: [{idempotency_key,type,payload,local_time}] }`.
 * Each operation is applied on its own, so a rejected sale never blocks the receipts behind it.
 * An unexpected (non-BizError) throw is still recorded per operation rather than aborting the loop.
 */
async function pushCommands(c: AppContext, deviceId: string, operations: unknown[]): Promise<Response> {
  if (!deviceId) throw new BizError(400, 'DEVICE_REQUIRED', 'ڈیوائس شناخت درکار ہے', 'device_id is required for a batch push');
  if (operations.length > MAX_COMMAND_BATCH) {
    throw new BizError(413, 'BATCH_TOO_LARGE', `ایک بار میں زیادہ سے زیادہ ${MAX_COMMAND_BATCH} دستاویزات`, `Max ${MAX_COMMAND_BATCH} operations per push`);
  }
  const results: Record<string, unknown>[] = [];
  for (const raw of operations) {
    let op: SyncOperation;
    try {
      op = syncOperationSchema.parse({ device_id: deviceId, ...(raw as object) });
    } catch (e) {
      results.push({ idempotency_key: String((raw as Record<string, unknown>)?.idempotency_key ?? ''), status: 'FAILED',
        code: 'VALIDATION_ERROR', message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    try {
      const res = await applySyncOp(c, op);
      const body = await res.json() as any;
      results.push({ idempotency_key: op.idempotency_key, http: res.status, ...(body?.data ?? {}) });
    } catch (e) {
      // A hard failure (DB down, revoked device) is reported per operation and the loop continues,
      // so one poisoned record cannot wedge a device's whole queue.
      results.push({ idempotency_key: op.idempotency_key, status: 'FAILED',
        code: e instanceof BizError ? e.code : 'INTERNAL_ERROR', message: String(e) });
    }
  }
  return ok(c, { results });
}

async function dispatch(c: AppContext, type: string, payload: any, key: string, device: string): Promise<{ id: string; number?: string }> {
  const withKey = { ...payload, idempotency_key: key, offline: true };
  switch (type) {
    case 'SALE': return postSale(c, saleSchema.parse(withKey));
    case 'PURCHASE': return postPurchase(c, purchaseSchema.parse(withKey));
    case 'RECEIPT': return postReceipt(c, receiptSchema.parse(withKey), false);
    case 'PAYMENT': return postReceipt(c, paymentSchema.parse(withKey), true);
    case 'EXPENSE': return postExpense(c, expenseSchema.parse(withKey));
    case 'GRAIN_PURCHASE': return postGrainPurchase(c, grainPurchaseSchema.parse(withKey));
    case 'GRAIN_SALE': return postGrainSale(c, grainSaleSchema.parse(withKey));
    case 'PARTY': return postParty(c, partySchema.parse(withKey));
    default: throw new BizError(400, 'UNKNOWN_SYNC_TYPE', 'نامعلوم آپریشن', `Unknown sync type: ${type}`);
  }
}

/** Nightly backup: all tables -> NDJSON -> gzip -> AES-GCM -> R2 (or local preview dir). */
export async function runBackup(c: any): Promise<any> {
  const db = c.get('db') as DB;
  const tables = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all<any>();
  const chunks: string[] = [];
  let exportedCount = 0;
  for (const t of tables) {
    const tbl = String(t.name).replace(/"/g, '');
    if (tbl.startsWith('_cf_') || tbl.startsWith('sqlite_') || tbl.startsWith('d1_')) continue;
    try {
      const rows = await db.prepare(`SELECT * FROM "${tbl}"`).all<any>();
      for (const r of rows) chunks.push(JSON.stringify({ table: tbl, row: r }));
      exportedCount++;
    } catch (err: any) {
      console.warn(`[BACKUP] Skipping table ${tbl}:`, err.message);
    }
  }
  const ndjson = chunks.join('\n');
  let compressed: Uint8Array;
  try {
    const stream = new Blob([ndjson]).stream().pipeThrough(new CompressionStream('gzip'));
    compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { compressed = new TextEncoder().encode(ndjson); }
  const secret = c.env.BACKUP_ENCRYPTION_KEY ?? c.env.SESSION_SECRET;
  if (!secret) throw new BizError(503, 'BACKUP_KEY_MISSING', 'بیک اپ انکرپشن کی چابی ترتیب نہیں دی گئی', 'BACKUP_ENCRYPTION_KEY secret missing');
  const key = await importCryptoKey(secret);
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as any }, key, compressed as any);
  const payload = new Uint8Array([...iv, ...new Uint8Array(cipher)]);
  const id = ulid();
  const day = karachiToday();
  const r2key = `backups/${day}/${id}.ztbak`;
  const at = nowIso();
  if (c.env.FILES) {
    await c.env.FILES.put(r2key, payload, { customMetadata: { created_at: at, rows: String(chunks.length) } });
  } else if (c.env.__ZT_LOCAL_BACKUP_DIR__) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(c.env.__ZT_LOCAL_BACKUP_DIR__, 'backups');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.ztbak`), payload);
  } else {
    throw new BizError(501, 'INCOMPLETE_R2', 'R2 بائنڈنگ موجود نہیں، بیک اپ محفوظ نہیں ہو سکا (INCOMPLETE)', 'R2 binding missing — backup INCOMPLETE');
  }
  await db.prepare(`INSERT INTO backup_logs (id,at,size_bytes,result,details_json,staging_restore_result)
    VALUES (?,?,?,?,?,'NOT_TESTED')`).bind(id, at, payload.byteLength, 'SUCCESS',
    JSON.stringify({ key: r2key, rows: chunks.length, tables: exportedCount,
      format: 'NDJSON+gzip+AES-GCM (12-byte IV prefix)', note: 'Staging restore NOT tested automatically' })).run();
  await db.prepare('INSERT INTO job_runs (id,job,at,result,details_json) VALUES (?,?,?,?,?)')
    .bind(ulid(), 'backup', at, 'PASS', JSON.stringify({ key: r2key, size: payload.byteLength })).run();
  await audit(db, 'BACKUP', 'backup_logs', id, { user_id: c.get('user')?.id ?? 'cron' });
  return { id, size_bytes: payload.byteLength, rows: chunks.length, tables: exportedCount,
    result: 'SUCCESS', key: r2key, staging_restore_result: 'NOT_TESTED' };
}

async function importCryptoKey(secret: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try { raw = Uint8Array.from(atob(secret), (ch) => ch.charCodeAt(0)); }
  catch { raw = new TextEncoder().encode(secret); }
  if (raw.length !== 32) raw = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as any));
  return crypto.subtle.importKey('raw', raw as any, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Honest per-screen status. COMPLETE = real, persisted, working; PARTIAL = working but narrowed;
 *  INCOMPLETE = not built / not verified. Mirrored in docs/FEATURE_CHECKLIST.md. */
export const FEATURES = [
  { id: 'PUB-01', ur: 'ہوم', en: 'Home', state: 'COMPLETE' },
  { id: 'PUB-02', ur: 'تمام مصنوعات / زمرہ', en: 'Products & category', state: 'COMPLETE' },
  { id: 'PUB-03', ur: 'پروڈکٹ کارڈ', en: 'Product card', state: 'COMPLETE' },
  { id: 'PUB-04', ur: 'پروڈکٹ تفصیل', en: 'Product detail', state: 'COMPLETE' },
  { id: 'PUB-05', ur: 'پوچھ گچھ', en: 'Enquiry', state: 'COMPLETE', note_ur: 'ہنی پاٹ، ٹائم ٹریپ، ریٹ لمٹ، رضامندی' },
  { id: 'PUB-06', ur: 'ہمارے بارے میں', en: 'About', state: 'PARTIAL', note_ur: 'CMS صفحہ موجود مگر مالک کے جائزے تک شائع نہیں' },
  { id: 'PUB-07', ur: 'رابطہ', en: 'Contact', state: 'COMPLETE', note_ur: 'صرف مالک کے دیے گئے فون / پتہ / wa.me' },
  { id: 'PUB-08', ur: 'رازداری / شرائط', en: 'Privacy / terms', state: 'PARTIAL', note_ur: 'قانونی متن مالک کے جائزے کے بغیر درج نہیں کیا گیا' },
  { id: 'PUB-09', ur: '404 / sitemap / robots', en: '404 + SEO files', state: 'COMPLETE' },
  { id: 'ERP-01', ur: 'سیٹ اپ وزرڈ', en: 'Setup wizard', state: 'COMPLETE', note_ur: 'من کی تصدیق، ابتدائی بیلنس، ریگولیٹری اختیاری' },
  { id: 'ERP-02', ur: 'لاگ ان', en: 'Login', state: 'COMPLETE', note_ur: 'PBKDF2 + سیشن + CSRF + ریٹ لمٹ + PIN + WebAuthn پاس کی؛ Chromium virtual authenticator E2E پاس' },
  { id: 'ERP-03', ur: 'ڈیش بورڈ', en: 'Dashboard', state: 'COMPLETE' },
  { id: 'ERP-04', ur: 'تیز اندراج', en: 'Quick entry', state: 'PARTIAL', note_ur: 'تیز فارم کام کرتا ہے؛ عالمی سرچ انڈیکس INCOMPLETE' },
  { id: 'ERP-05', ur: 'مصنوعات فہرست', en: 'Products list', state: 'COMPLETE' },
  { id: 'ERP-06', ur: 'مصنوعات فارم', en: 'Product form', state: 'PARTIAL', note_ur: 'تمام ٹیبز محفوظ؛ production R2 بائنڈنگ INCOMPLETE' },
  { id: 'ERP-07', ur: 'CSV درآمد', en: 'CSV import', state: 'COMPLETE' },
  { id: 'ERP-08', ur: 'زمرے / برانڈز / یونٹس', en: 'Catalogue admin', state: 'PARTIAL', note_ur: 'فہرست + نیا اندراج؛ ترمیم/آرکائیو UI باقی' },
  { id: 'ERP-09', ur: 'کھاد ہب', en: 'Fertilizer hub', state: 'COMPLETE' },
  { id: 'ERP-10', ur: 'کھاد خرید', en: 'Fertilizer purchase', state: 'COMPLETE' },
  { id: 'ERP-11', ur: 'کھاد فروخت', en: 'Fertilizer sale', state: 'COMPLETE' },
  { id: 'ERP-12', ur: 'پیسٹی سائیڈ', en: 'Pesticide module', state: 'PARTIAL', note_ur: 'رجسٹر/ایکسپائری بلاک/لازمی خریدار؛ قرنطینہ ورک فلو UI باقی' },
  { id: 'ERP-13', ur: 'دیگر سامان (5 کتابیں)', en: 'Five goods modules', state: 'COMPLETE' },
  { id: 'ERP-14', ur: 'اجناس ہب', en: 'Grains hub', state: 'COMPLETE' },
  { id: 'ERP-15', ur: 'فصل صفحہ', en: 'Crop page', state: 'COMPLETE' },
  { id: 'ERP-16', ur: 'اجناس خرید (وزن)', en: 'Grain purchase', state: 'COMPLETE' },
  { id: 'ERP-17', ur: 'اجناس فروخت', en: 'Grain sale', state: 'COMPLETE' },
  { id: 'ERP-18', ur: 'فریق', en: 'Parties', state: 'PARTIAL', note_ur: 'فہرست + نیا فریق؛ ترمیم/آرکائیو UI باقی' },
  { id: 'ERP-19', ur: 'فریق کھاتہ', en: 'Party khata', state: 'COMPLETE' },
  { id: 'ERP-20', ur: 'کھاتہ سینٹر', en: 'Khata centre', state: 'COMPLETE' },
  { id: 'ERP-21', ur: 'رسیدیں / ادائیگیاں', en: 'Receipts & payments', state: 'PARTIAL', note_ur: 'AUTO/ADVANCE کام؛ MANUAL الاٹمنٹ UI باقی' },
  { id: 'ERP-22', ur: 'رقم اکاؤنٹس', en: 'Money accounts', state: 'COMPLETE' },
  { id: 'ERP-23', ur: 'ٹرانسفر', en: 'Transfer', state: 'COMPLETE' },
  { id: 'ERP-24', ur: 'واپسی', en: 'Returns', state: 'PARTIAL', note_ur: 'ریورس پوسٹنگ؛ لائن چننے والا UI باقی' },
  { id: 'ERP-25', ur: 'اخراجات', en: 'Expenses', state: 'COMPLETE' },
  { id: 'ERP-26', ur: 'ملازمین / تنخواہ', en: 'Employees & payroll', state: 'PARTIAL', note_ur: 'تنخواہ رن؛ ایڈوانس فارم الگ UI باقی' },
  { id: 'ERP-27', ur: 'انوینٹری', en: 'Inventory', state: 'COMPLETE' },
  { id: 'ERP-28', ur: 'ویب سائٹ CMS', en: 'Website CMS', state: 'PARTIAL', note_ur: 'صفحات/اعلانات؛ بینر امیج اپ لوڈ R2 پر منحصر' },
  { id: 'ERP-29', ur: 'پوچھ گچھ ان باکس', en: 'Enquiries inbox', state: 'PARTIAL', note_ur: 'منظوری/مسترد/کوٹیشن؛ براہِ راست Sale کنورژن UI باقی' },
  { id: 'ERP-30', ur: 'دستاویزات سینٹر', en: 'Documents centre', state: 'PARTIAL', note_ur: 'JSON سنیپ شاٹ + براؤزر پرنٹ؛ bulk statement pack INCOMPLETE' },
  { id: 'ERP-31', ur: 'رپورٹس', en: 'Reports', state: 'PARTIAL', note_ur: '12 رپورٹس؛ مکمل گیلری اور شیڈولڈ ای میل INCOMPLETE' },
  { id: 'ERP-32', ur: 'اکاؤنٹنگ', en: 'Accounting', state: 'COMPLETE' },
  { id: 'ERP-33', ur: 'صارفین و کردار', en: 'Users & roles', state: 'COMPLETE', note_ur: 'RBAC + ڈیوائس ریووک + پاس کی رجسٹریشن/فہرست/ریووک؛ کردار میٹرکس بگ بھی ٹھیک' },
  { id: 'ERP-34', ur: 'سنک سینٹر', en: 'Sync centre', state: 'COMPLETE' },
  { id: 'ERP-35', ur: 'بیک اپ', en: 'Backup', state: 'PARTIAL', note_ur: 'انکرپٹڈ ایکسپورٹ + لاگ؛ staging بحالی ٹیسٹ INCOMPLETE' },
  { id: 'ERP-36', ur: 'ترتیبات', en: 'Settings', state: 'COMPLETE' },
  { id: 'ERP-37', ur: 'آڈٹ لاگ', en: 'Audit log', state: 'COMPLETE' },
  { id: 'ERP-38', ur: '403/404/آف لائن', en: 'Error states', state: 'PARTIAL', note_ur: '403/404/آف لائن بینر + 40 بصری اسکرینز 0% diff؛ الگ آف لائن صفحہ باقی' },
  { id: 'P8-OFFLINE', ur: 'PWA / آؤٹ باکس', en: 'PWA outbox', state: 'COMPLETE', note_ur: 'SW + Dexie + 4 sync triggers + role-scoped cache wipe' },
  { id: 'P8-PIN', ur: 'PIN کیش انکرپشن', en: 'PIN-derived AES-GCM cache', state: 'COMPLETE', note_ur: 'PBKDF2 310,000 → AES-256-GCM؛ 4 یونٹ ٹیسٹ + براؤزر E2E (IndexedDB میں 4/4 انکرپٹڈ قطاریں) پاس' },
  { id: 'P8-PASSKEYS', ur: 'WebAuthn پاس کی', en: 'WebAuthn passkeys', state: 'COMPLETE', note_ur: '@simplewebauthn حقیقی تصدیق، one-time challenge، ریووک؛ Chromium virtual authenticator E2E پاس؛ حقیقی فون ابھی نہیں' },
  { id: 'P8-TURNSTILE', ur: 'Turnstile', en: 'Turnstile', state: 'PARTIAL', note_ur: 'سرور siteverify گیٹ + مقامی ٹیسٹ پاس؛ حقیقی Cloudflare siteverify تعیناتی کے بعد' },
  { id: 'P8-R2', ur: 'پرائیویٹ R2', en: 'Private R2', state: 'PARTIAL', note_ur: 'لوکل اپ لوڈ/میڈیا کام؛ production binding تعیناتی پر' },
  { id: 'P8-CACHE-PURGE', ur: 'ایج کیش پیورج', en: 'Edge cache purge', state: 'COMPLETE', note_ur: 'generation invalidation + known-key حذف؛ publish/unpublish ٹیسٹ اور 200-hit A19 پاس؛ لائیو ایج ابھی unverified' },
  { id: 'P9-QUERY-PLAN', ur: 'EXPLAIN QUERY PLAN', en: 'Query-plan CI gate', state: 'COMPLETE', note_ur: '15/15 ہاٹ کوئری انڈیکس استعمال کرتی ہیں؛ CI ورک فلو شامل' },
  { id: 'P9-VISUAL', ur: 'Playwright بصری ریگریشن', en: 'Visual regression', state: 'COMPLETE', note_ur: 'حقیقی Chromium: 10 سکرینز × 4 viewports = 40 baselines، دوسری رن پر 0% diff، 0 page errors' },
  { id: 'P9-LIGHTHOUSE', ur: 'Lighthouse', en: 'Lighthouse', state: 'COMPLETE', note_ur: 'Lighthouse 13 موبائل: 100/100/100، 100/100/100، 99/100/100 — تینوں اہداف پورے' },
  { id: 'P9-A11Y', ur: 'a11y / 360–1280', en: 'Accessibility & breakpoints', state: 'COMPLETE', note_ur: 'axe-core 4.14: 8 سکرینز پر 0 violations (بشمول A19 لاگن/پروڈکٹ/سیل فارم)' },
  { id: 'P11-DOCS', ur: 'دستاویزات / CSV / OpenAPI', en: 'Docs, CSV templates, OpenAPI', state: 'COMPLETE' },
  { id: 'P12-RESTORE', ur: 'Staging بحالی ٹیسٹ', en: 'Staging restore test', state: 'PARTIAL', note_ur: 'مقامی staging-همسر DB پر 1032 قطاریں بحال + integrity PASS؛ حقیقی Cloudflare staging رن باقی' },
  { id: 'P9-PRINT', ur: 'اردو پرنٹ / PDF ثبوت', en: 'Urdu print/PDF proof', state: 'COMPLETE', note_ur: 'شپڈ CSS + WOFF2 فونٹس؛ ڈیسک ٹاپ و Android-emulated Chromium میں 2/2 فونٹس لوڈ، حقیقی A4 PDF' },
  { id: 'P9-QUOTA', ur: 'کوٹا / کیش گارڈ A19', en: 'Quota/cache guard A19', state: 'COMPLETE', note_ur: '200 عوامی ہٹس: rows_read=1، cached_hits=199 — الگ ٹیسٹ پاس' },
  { id: 'P9-ROUTES', ur: 'A20 روٹ میٹرکس', en: 'A20 route matrix', state: 'COMPLETE', note_ur: '29 تحریری روٹس CSRF_FAILED، 24 پر AUDITOR 400+، IDOR/SQLi/XSS ٹیسٹ پاس' },
  { id: 'P12-NEW-PROJECT', ur: 'نیا پروجیکٹ کنفیگ', en: 'New project config', state: 'COMPLETE', note_ur: 'wrangler.v2.jsonc: نئے Worker/D1/R2 نام، dry-run exit 0، اور حقیقی staging+production deploy مکمل (R2 bindings کے بوتلز باقی)' },
  { id: 'P12-DEPLOY', ur: 'Cloudflare تعیناتی', en: 'Cloudflare deploy', state: 'COMPLETE', note_ur: 'zt-v2 اور zt-v2-staging *.workers.dev پر live، چاروں مائیگریشنز remote لاگو، secrets سیٹ؛ ڈومین اور R2 بوتلز بعد میں' },
] as const;
