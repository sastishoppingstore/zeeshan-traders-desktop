/** Shared service helpers: account resolution, payments, warnings, audit after commit. */
import type { DB } from '../db.js';
import { BizError, audit, getSetting, purgePublicCache, type AppContext } from '../context.js';
import { BOOK_MAP, MONEY_MAP } from '@zt/shared';
import type { SessionUser } from '@zt/shared';

export interface AccountRow {
  id: string; code: string; name_ur: string; gl_code: string; type: string;
}

export async function resolveAccount(db: DB, ref: string): Promise<AccountRow> {
  const row = await db.prepare('SELECT id,code,name_ur,gl_code,type FROM financial_accounts WHERE id=? OR code=? LIMIT 1')
    .bind(ref, ref).first<AccountRow>();
  if (!row) throw new BizError(400, 'ACCOUNT_NOT_FOUND', 'اکاؤنٹ نہیں ملا', `Unknown money book: ${ref}`);
  return row;
}

export interface PaymentResolved {
  account: AccountRow;
  amount_paisa: number;
}

export async function resolvePayments(db: DB, parts: { account_id: string; amount_paisa: number }[], total: number): Promise<PaymentResolved[]> {
  const out: PaymentResolved[] = [];
  let sum = 0;
  for (const p of parts) {
    if (p.amount_paisa < 0) throw new BizError(400, 'NEGATIVE_PAYMENT', 'منفی رقم درست نہیں', 'Negative payment amount');
    if (p.amount_paisa === 0) continue;
    sum += p.amount_paisa;
    out.push({ account: await resolveAccount(db, p.account_id), amount_paisa: p.amount_paisa });
  }
  if (sum > total) throw new BizError(400, 'PAID_EXCEEDS_TOTAL', 'ادا شدہ رقم کل سے زیادہ ہے', 'Paid amount exceeds total');
  return out;
}

export const journalPayments = (p: PaymentResolved[]) => p.map((x) => ({ account_id: x.account.code, amount_paisa: x.amount_paisa }));

export function paymentMethod(p: PaymentResolved[]): string {
  if (!p.length) return 'ادھار / Credit';
  return p.map((x) => x.account.name_ur).join(' + ');
}

export async function checkProductBelongsToBook(db: DB, product_id: string, book_code: string) {
  let row = await db.prepare(`SELECT p.id,p.name_ur,p.name_en,p.is_active,p.track_batch,p.track_expiry,p.is_pesticide,p.base_unit,p.sale_rate_paisa,p.purchase_rate_paisa,p.reorder_level_milli,
      p.category_id,c.book_code,c.name_ur AS category_ur,p.conversion_ratio_milli,p.grams_per_base_unit
    FROM products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE p.id=?`)
    .bind(product_id).first<any>();
  if (!row) {
    const cat = await db.prepare("SELECT id, name_ur, book_code FROM product_categories WHERE book_code=? OR code=? LIMIT 1").bind(book_code, book_code).first<any>();
    const catId = cat?.id ?? 'cat-fertilizer';
    const short = (product_id || '').slice(-6) || 'off';
    await db.prepare(`INSERT OR IGNORE INTO products (id,name_ur,name_en,slug,category_id,sku,base_unit,purchase_unit,sale_unit,conversion_ratio_milli,grams_per_base_unit,purchase_rate_paisa,sale_rate_paisa,public_price_paisa,is_active,is_published,created_at,updated_at,version)
      VALUES (?,?,'General Item',?,?,?,'piece','piece','piece',1000,1000,0,0,0,1,1,datetime('now'),datetime('now'),1)`)
      .bind(product_id, `پروڈکٹ ${short}`, `prod-${short}-${Date.now().toString().slice(-4)}`, catId, `SKU-${short}`).run();
    row = await db.prepare(`SELECT p.id,p.name_ur,p.name_en,p.is_active,p.track_batch,p.track_expiry,p.is_pesticide,p.base_unit,p.sale_rate_paisa,p.purchase_rate_paisa,p.reorder_level_milli,
      p.category_id,c.book_code,c.name_ur AS category_ur,p.conversion_ratio_milli,p.grams_per_base_unit
      FROM products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE p.id=?`)
      .bind(product_id).first<any>();
  }
  if (!row) throw new BizError(400, 'PRODUCT_NOT_FOUND', 'مصنوعات نہیں ملی', `Product not found: ${product_id}`);
  if (!row.is_active) throw new BizError(409, 'PRODUCT_ARCHIVED', 'یہ مصنوعات غیر فعال ہے', 'Product is archived');
  const book = BOOK_MAP[book_code] || BOOK_MAP['GENERAL'];
  if (!book) throw new BizError(400, 'UNKNOWN_BOOK', 'نامعلوم کھاتہ کتاب', 'Unknown book');
  return {
    ...row,
    book_code: row.book_code || book_code || 'GENERAL',
    category_ur: row.category_ur || 'جنرل',
  } as {
    id: string; name_ur: string; name_en: string; is_active: number; track_batch: number;
    track_expiry: number; is_pesticide: number; base_unit: string; sale_rate_paisa: number;
    purchase_rate_paisa: number; reorder_level_milli: number; category_id: string;
    book_code: string; category_ur: string; conversion_ratio_milli: number; grams_per_base_unit: number;
  };
}

export async function bookFromProduct(db: DB, product_id: string): Promise<string> {
  const row = await db.prepare('SELECT c.book_code FROM products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE p.id=?')
    .bind(product_id).first<{ book_code: string | null }>();
  return row?.book_code || 'GENERAL';
}

export async function maybeWarnCredit(db: DB, party_id: string, added: number, warnings: string[]): Promise<void> {
  const row = await db.prepare('SELECT credit_limit_paisa,name_ur FROM parties WHERE id=?').bind(party_id).first<{ credit_limit_paisa: number; name_ur: string }>();
  if (!row || row.credit_limit_paisa <= 0) return;
  const bal = await db.prepare('SELECT balance_paisa FROM party_balance WHERE party_id=?').bind(party_id).first<{ balance_paisa: number }>();
  if ((bal?.balance_paisa ?? 0) + added > row.credit_limit_paisa) {
    warnings.push(`کریڈٹ حد سے تجاوز: ${row.name_ur} (Credit limit warning)`);
  }
}

export async function afterCommit(c: AppContext, action: string, entity: string, id: string, after: unknown, before?: unknown): Promise<void> {
  const db = c.get('db')!;
  const u = c.get('user');
  await audit(db, action, entity, id, { user_id: u?.id ?? null, after, before });
}

export async function setting<T = unknown>(c: AppContext, key: string): Promise<T | undefined> {
  return getSetting<T>(c.get('db')!, key);
}

export function requirePermission(c: AppContext, perm: string): SessionUser {
  const u = c.get('user');
  if (!u) throw new BizError(401, 'UNAUTHENTICATED', 'لاگ ان ضروری ہے', 'Login required');
  if (!u.permissions.includes('*') && !u.permissions.includes(perm)) {
    throw new BizError(403, 'PERMISSION_DENIED', 'اجازت نہیں ہے', `Permission denied: ${perm}`);
  }
  return u;
}

export function moneyCode(ref: string): string {
  return MONEY_MAP[ref] ? ref : Object.keys(MONEY_MAP).find((k) => ref.endsWith(k.toLowerCase())) ?? 'CASH';
}

/** URL-safe slug from a display name. Only the server normalises this, because the public product
 *  URL depends on the slug being normalised and unique — which a client cannot guarantee offline. */
export function slugify(name: string): string {
  const base = String(name ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return (base || 'item').slice(0, 120);
}

/**
 * A slug that is unique within `table`, suffixing -2, -3 … and finally a random tail, exactly as the
 * catalogue handlers do. The online `POST /products` and the offline row-push both call this, so a
 * product created at the counter gets the same kind of slug as one created in the browser.
 * `table` is always a registry name (never client input) — callers pass it through `sqlId()`.
 */
export async function uniqueSlugForTable(db: DB, table: string, source: string, excludeId?: string): Promise<string> {
  const base = slugify(source);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const row = await db.prepare(`SELECT id FROM ${table} WHERE slug=?`).bind(slug).first<{ id: string }>();
    if (!row || row.id === excludeId) return slug;
  }
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

export async function purgeIfCatalogue(): Promise<void> { await purgePublicCache(); }
