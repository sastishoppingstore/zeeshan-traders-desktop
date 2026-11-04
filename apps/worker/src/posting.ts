/**
 * Atomic posting engine (H2/H3/H4).
 * ONE db.batch() per posting containing: document + lines + stock movements +
 * stock_balance + party_ledger + party_balance + account_transactions +
 * account_balance + balanced journal + daily_summary + documents + sync_operations.
 * Pre-validation happens BEFORE the batch. Conditional (optimistic) UPDATEs on the
 * balance/sequence rows make races detectable; a failed check retries or becomes a
 * sync conflict. No posted financial row is ever UPDATEd/DELETEd — fixes are reversals.
 */
import type { DB, Q } from './db.js';
import { v } from './db.js';
import { ulid, assertBalanced, type JournalLine, TEMPLATE_VERSION } from '@zt/shared';
import type { SessionUser, DocumentSnapshot } from '@zt/shared';
import { BizError, nextValue, nowIso, seqNumber as seqNumberLocal } from './context.js';

export interface StockState { product_id: string; warehouse_id: string; qty_milli: number; value_paisa: number }
export interface BatchState { batch_id: string; warehouse_id: string; qty_milli: number; value_paisa: number }
export type AccountState = number;
export type PartyState = number;

export class ConcurrentModification extends Error {
  constructor(public what: string) { super(`concurrent modification: ${what}`); }
}

export class BatchBuilder {
  readonly stmts: Q[] = [];
  constructor(public readonly db: DB) {}
  add(sql: string, ...args: unknown[]): number {
    this.stmts.push(this.db.prepare(sql).bind(...args.map(v)));
    return this.stmts.length - 1;
  }
  async commit(): Promise<{ changes: number }[]> { return this.db.batch(this.stmts); }
}

export interface Conditional { index: number; what: string }

export class Posting {
  readonly b: BatchBuilder;
  readonly conditionals: Conditional[] = [];
  readonly stock = new Map<string, StockState>();
  readonly stockOriginal = new Map<string, number>();
  readonly batches = new Map<string, BatchState>();
  readonly batchesOriginal = new Map<string, number>();
  readonly accounts = new Map<string, AccountState>();
  readonly accountsOriginal = new Map<string, number>();
  readonly parties = new Map<string, PartyState>();
  readonly partiesOriginal = new Map<string, number>();
  readonly at = nowIso();

  constructor(
    public readonly db: DB,
    public readonly actor: SessionUser,
    public readonly date: string,
    public readonly warehouse_id = 'wh-main',
  ) { this.b = new BatchBuilder(db); }

  // ------------------------------ state reads ------------------------------
  async stockState(product_id: string): Promise<StockState> {
    const key = `${product_id}|${this.warehouse_id}`;
    let s = this.stock.get(key);
    if (!s) {
      const row = await this.db.prepare('SELECT qty_milli,value_paisa FROM stock_balance WHERE product_id=? AND warehouse_id=?')
        .bind(product_id, this.warehouse_id).first<{ qty_milli: number; value_paisa: number }>();
      s = { product_id, warehouse_id: this.warehouse_id, qty_milli: row?.qty_milli ?? 0, value_paisa: row?.value_paisa ?? 0 };
      this.stock.set(key, s);
      this.stockOriginal.set(key, s.qty_milli);
    }
    return s;
  }
  async batchState(batch_id: string): Promise<BatchState> {
    const key = `${batch_id}|${this.warehouse_id}`;
    let s = this.batches.get(key);
    if (!s) {
      const row = await this.db.prepare('SELECT qty_milli,value_paisa FROM stock_batch_balance WHERE batch_id=? AND warehouse_id=?')
        .bind(batch_id, this.warehouse_id).first<{ qty_milli: number; value_paisa: number }>();
      s = { batch_id, warehouse_id: this.warehouse_id, qty_milli: row?.qty_milli ?? 0, value_paisa: row?.value_paisa ?? 0 };
      this.batches.set(key, s);
      this.batchesOriginal.set(key, s.qty_milli);
    }
    return s;
  }
  async accountState(account_id: string): Promise<number> {
    if (!this.accounts.has(account_id)) {
      const row = await this.db.prepare('SELECT balance_paisa FROM account_balance WHERE account_id=?')
        .bind(account_id).first<{ balance_paisa: number }>();
      const value = row?.balance_paisa ?? 0;
      this.accounts.set(account_id, value);
      this.accountsOriginal.set(account_id, value);
    }
    return this.accounts.get(account_id)!;
  }
  async partyState(party_id: string): Promise<number> {
    if (!this.parties.has(party_id)) {
      const row = await this.db.prepare('SELECT balance_paisa FROM party_balance WHERE party_id=?')
        .bind(party_id).first<{ balance_paisa: number }>();
      const value = row?.balance_paisa ?? 0;
      this.parties.set(party_id, value);
      this.partiesOriginal.set(party_id, value);
    }
    return this.parties.get(party_id)!;
  }

  // ------------------------------ primitives ------------------------------
  stockIn(input: {
    product_id: string; batch_id?: string | null; qty_milli: number; cost_total_paisa: number;
    unit_cost_paisa: number; ref_type: string; ref_id: string; book_code: string; note?: string;
  }): void {
    const s = this.stock.get(`${input.product_id}|${this.warehouse_id}`);
    if (!s) throw new Error('stockIn called before stockState()');
    if (input.qty_milli <= 0) throw new Error('stock in quantity must be positive');
    s.qty_milli += input.qty_milli;
    s.value_paisa += input.cost_total_paisa;
    this.b.add(`INSERT INTO stock_movements (id,date,product_id,batch_id,warehouse_id,qty_in_milli,qty_out_milli,unit_cost_paisa,cost_total_paisa,ref_type,ref_id,book_code,note,created_at,created_by)
      VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`,
      ulid(), this.date, input.product_id, input.batch_id ?? null, this.warehouse_id,
      input.qty_milli, input.unit_cost_paisa, input.cost_total_paisa,
      input.ref_type, input.ref_id, input.book_code, input.note ?? '', this.at, this.actor.id);
    if (input.batch_id) {
      const bs = this.batches.get(`${input.batch_id}|${this.warehouse_id}`);
      if (bs) { bs.qty_milli += input.qty_milli; bs.value_paisa += input.cost_total_paisa; }
    }
  }

  /** Issues stock at weighted-average cost. Throws if negative stock would result. */
  stockOut(input: {
    product_id: string; batch_id?: string | null; qty_milli: number; cost_total_paisa: number;
    unit_cost_paisa: number; ref_type: string; ref_id: string; book_code: string; note?: string;
  }): void {
    const s = this.stock.get(`${input.product_id}|${this.warehouse_id}`);
    if (!s) throw new Error('stockOut called before stockState()');
    if (input.qty_milli <= 0 || input.qty_milli > s.qty_milli) {
      throw new BizError(409, 'INSUFFICIENT_STOCK', 'اسٹاک ناکافی ہے', 'Insufficient stock for this line');
    }
    s.qty_milli -= input.qty_milli;
    s.value_paisa -= input.cost_total_paisa;
    this.b.add(`INSERT INTO stock_movements (id,date,product_id,batch_id,warehouse_id,qty_in_milli,qty_out_milli,unit_cost_paisa,cost_total_paisa,ref_type,ref_id,book_code,note,created_at,created_by)
      VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)`,
      ulid(), this.date, input.product_id, input.batch_id ?? null, this.warehouse_id,
      input.qty_milli, input.unit_cost_paisa, input.cost_total_paisa,
      input.ref_type, input.ref_id, input.book_code, input.note ?? '', this.at, this.actor.id);
    if (input.batch_id) {
      const bs = this.batches.get(`${input.batch_id}|${this.warehouse_id}`);
      if (bs) { bs.qty_milli -= input.qty_milli; bs.value_paisa -= input.cost_total_paisa; }
    }
  }

  accountTxn(input: {
    account_id: string; direction: 'IN' | 'OUT'; amount_paisa: number;
    ref_type: string; ref_id: string; description_ur?: string;
  }): void {
    if (input.amount_paisa <= 0) return;
    const delta = input.direction === 'IN' ? input.amount_paisa : -input.amount_paisa;
    const current = this.accounts.get(input.account_id);
    if (current === undefined) throw new Error('accountTxn called before accountState()');
    this.accounts.set(input.account_id, current + delta);
    this.b.add(`INSERT INTO account_transactions (id,account_id,date,direction,amount_paisa,ref_type,ref_id,description_ur,matched,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
      ulid(), input.account_id, this.date, input.direction, input.amount_paisa,
      input.ref_type, input.ref_id, input.description_ur ?? '', this.at, this.actor.id);
  }

  /** debit increases what the party owes us; credit decreases it (negative = we owe them). */
  partyLedger(input: {
    party_id: string; book_code: string; debit_paisa?: number; credit_paisa?: number;
    ref_type: string; ref_id: string; description_ur: string;
  }): void {
    const debit = input.debit_paisa ?? 0, credit = input.credit_paisa ?? 0;
    if (debit <= 0 && credit <= 0) return;
    const current = this.parties.get(input.party_id);
    if (current === undefined) throw new Error('partyLedger called before partyState()');
    this.parties.set(input.party_id, current + debit - credit);
    this.b.add(`INSERT INTO party_ledger (id,date,party_id,book_code,ref_type,ref_id,description_ur,debit_paisa,credit_paisa,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ulid(), this.date, input.party_id, input.book_code, input.ref_type, input.ref_id,
      input.description_ur, debit, credit, this.at);
  }

  journal(input: { ref_type: string; ref_id: string; memo_ur: string; lines: JournalLine[]; reason?: string; is_reversal?: number; reverses_id?: string | null }): string {
    assertBalanced(input.lines);
    const id = ulid();
    this.b.add(`INSERT INTO journal_entries (id,number,date,period_ym,ref_type,ref_id,memo_ur,reason,is_reversal,reverses_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, `JRN-${id}`, this.date, this.date.slice(0, 7), input.ref_type, input.ref_id,
      input.memo_ur, input.reason ?? '', input.is_reversal ?? 0, input.reverses_id ?? null, this.at, this.actor.id);
    for (const l of input.lines) {
      this.b.add(`INSERT INTO journal_lines (id,entry_id,account_code,debit_paisa,credit_paisa,party_id,book_code,memo)
        VALUES (?,?,?,?,?,?,?,?)`,
        ulid(), id, l.account_code, l.debit_paisa, l.credit_paisa,
        l.party_id ?? null, l.book_code ?? null, l.memo ?? '');
    }
    return id;
  }

  summary(book_code: string, metric: string, value_paisa = 0, value_milli = 0): void {
    this.b.add(`INSERT INTO daily_summary (date,book_code,metric,value_paisa,value_milli,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(date,book_code,metric) DO UPDATE SET
        value_paisa = value_paisa + excluded.value_paisa,
        value_milli = value_milli + excluded.value_milli,
        updated_at = excluded.updated_at`,
      this.date, book_code, metric, value_paisa, value_milli, this.at);
  }

  document(input: {
    type: string; number: string; party_id: string | null; amount_paisa: number;
    book_code?: string | null; ref_id: string; snapshot: DocumentSnapshot;
  }): void {
    // The document ULID is generated once, used both as the row primary key and embedded in the
    // stored snapshot as `doc_id`. The snapshot is serialized here (not by the caller), so hoisting
    // the id is what lets the printed QR point at /verify/<doc_id>. Synchronous on purpose: no
    // WebCrypto HMAC, the 26-char ULID itself is the unguessable capability.
    const id = ulid();
    const snapshot: DocumentSnapshot = { ...input.snapshot, doc_id: input.snapshot.doc_id ?? id };
    this.b.add(`INSERT INTO documents (id,type,number,party_id,date,amount_paisa,book_code,ref_id,snapshot_json,template_version,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.type, input.number, input.party_id, this.date, input.amount_paisa,
      input.book_code ?? null, input.ref_id, JSON.stringify(snapshot), TEMPLATE_VERSION, this.at, this.actor.id);
  }

  syncOperation(input: { key: string; device_id: string; type: string; payload: unknown; local_time: string; doc_id: string; number: string }): void {
    this.b.add(`INSERT INTO sync_operations (id,idempotency_key,device_id,user_id,type,payload_json,local_time,status,tries,server_doc_id,server_number,created_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?,?)
      ON CONFLICT(idempotency_key) DO NOTHING`,
      ulid(), input.key, input.device_id, this.actor.id, input.type,
      JSON.stringify(input.payload), input.local_time, 'SYNCED', input.doc_id, input.number, this.at);
  }

  /** Gapless server numbering: conditional UPDATE inside the same batch. */
  async reserveNumber(code: string): Promise<string> { return (await this.reserveNumbers(code, 1))[0]; }

  /** Reserve N consecutive numbers with ONE conditional update (used by payroll sheets). */
  async reserveNumbers(code: string, count: number): Promise<string[]> {
    const seq = await nextValue(this.db, code);
    const idx = this.b.add('UPDATE invoice_sequences SET next_value=next_value+?, updated_at=? WHERE code=? AND next_value=?',
      count, this.at, code, seq.value);
    this.conditionals.push({ index: idx, what: `sequence:${code}` });
    return Array.from({ length: count }, (_, i) => seqNumberLocal(seq.prefix, seq.value + i));
  }

  // --------------------------- finalise & commit ---------------------------
  private finalise(): void {
    for (const [key, s] of this.stock) {
      const original = this.stockOriginal.get(key)!;
      const idx = this.b.add(`INSERT INTO stock_balance (product_id,warehouse_id,qty_milli,value_paisa,updated_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(product_id,warehouse_id) DO UPDATE SET
          qty_milli=excluded.qty_milli, value_paisa=excluded.value_paisa, updated_at=excluded.updated_at
        WHERE stock_balance.qty_milli = ?`,
        s.product_id, s.warehouse_id, s.qty_milli, s.value_paisa, this.at, original);
      this.conditionals.push({ index: idx, what: `stock:${s.product_id}` });
    }
    for (const [key, s] of this.batches) {
      const original = this.batchesOriginal.get(key)!;
      const unit = s.qty_milli > 0 ? Math.floor(s.value_paisa * 1000 / s.qty_milli) : 0;
      const idx = this.b.add(`INSERT INTO stock_batch_balance (batch_id,warehouse_id,qty_milli,value_paisa,unit_cost_paisa,updated_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(batch_id,warehouse_id) DO UPDATE SET
          qty_milli=excluded.qty_milli, value_paisa=excluded.value_paisa,
          unit_cost_paisa=excluded.unit_cost_paisa, updated_at=excluded.updated_at
        WHERE stock_batch_balance.qty_milli = ?`,
        s.batch_id, s.warehouse_id, s.qty_milli, s.value_paisa, unit, this.at, original);
      this.conditionals.push({ index: idx, what: `batch:${s.batch_id}` });
    }
    for (const [id, balance] of this.accounts) {
      const original = this.accountsOriginal.get(id)!;
      if (balance === original) continue;
      const idx = this.b.add(`INSERT INTO account_balance (account_id,balance_paisa,updated_at)
        VALUES (?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET balance_paisa=excluded.balance_paisa, updated_at=excluded.updated_at
        WHERE account_balance.balance_paisa = ?`, id, balance, this.at, original);
      this.conditionals.push({ index: idx, what: `account:${id}` });
    }
    for (const [id, balance] of this.parties) {
      const original = this.partiesOriginal.get(id)!;
      if (balance === original) continue;
      const idx = this.b.add(`INSERT INTO party_balance (party_id,balance_paisa,updated_at)
        VALUES (?,?,?)
        ON CONFLICT(party_id) DO UPDATE SET balance_paisa=excluded.balance_paisa, updated_at=excluded.updated_at
        WHERE party_balance.balance_paisa = ?`, id, balance, this.at, original);
      this.conditionals.push({ index: idx, what: `party:${id}` });
    }
  }

  async commit(): Promise<void> {
    this.finalise();
    const results = await this.b.commit();
    for (const cond of this.conditionals) {
      const r = results[cond.index];
      if (!r || r.changes !== 1) throw new ConcurrentModification(cond.what);
    }
  }
}

/** Retry a posting when a concurrent writer changed a balance/sequence first. */
export async function withPostingRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      if (e instanceof ConcurrentModification) { last = e; continue; }
      throw e;
    }
  }
  throw new BizError(409, 'CONCURRENT_MODIFICATION', 'ہم وقت اندراج کی وجہ سے دوبارہ کوشش کریں', 'Concurrent write — please retry', { detail: String(last) });
}

export interface PartyRef { id: string; name: string; phone: string; address: string; created: boolean }

/** Resolve an existing party or create one inline inside the posting batch. */
export async function resolveParty(input: {
  db: DB; posting: Posting; party_id?: string | null; name?: string; phone?: string;
  address?: string; type: 'CUSTOMER' | 'SUPPLIER' | 'FARMER' | 'EMPLOYEE';
  cnic_enc?: string | null; credit_limit_paisa?: number;
}): Promise<PartyRef> {
  const { db, posting } = input;
  let row: any = null;
  if (input.party_id) {
    row = await db.prepare('SELECT id,name_ur,phone,village FROM parties WHERE id=?').bind(input.party_id).first<any>();
    if (!row) throw new BizError(400, 'PARTY_NOT_FOUND', 'فریق نہیں ملا', 'Party not found');
  } else if (input.name) {
    row = await db.prepare('SELECT id,name_ur,phone,village FROM parties WHERE name_ur=? AND phone=? LIMIT 1')
      .bind(input.name.trim(), input.phone ?? '').first<any>();
  }
  if (!row) {
    if (!input.name || input.name.trim().length < 2) throw new BizError(400, 'PARTY_REQUIRED', 'فریق کا نام درکار ہے', 'Party name is required');
    const id = ulid();
    posting.b.add(`INSERT INTO parties (id,name_ur,name_en,phone,village,type,opening_balance_paisa,opening_direction,credit_limit_paisa,cnic_enc,notes,is_active,created_at,created_by,updated_at,version)
      VALUES (?,?,?,?,?,?,0,'RECEIVABLE',?,?,'',1,?,?,?,1)`,
      id, input.name.trim(), '', input.phone ?? '', input.address ?? '', input.type,
      input.credit_limit_paisa ?? 0, input.cnic_enc ?? null, posting.at, posting.actor.id, posting.at);
    posting.parties.set(id, 0);
    posting.partiesOriginal.set(id, 0);
    return { id, name: input.name.trim(), phone: input.phone ?? '', address: input.address ?? '', created: true };
  }
  await posting.partyState(row.id);
  return { id: row.id, name: row.name_ur, phone: row.phone ?? '', address: row.village ?? '', created: false };
}

/** Find or create a batch row inside the batch. Batch/expiry rules are validated by callers. */
export async function ensureBatch(input: {
  db: DB; posting: Posting; product_id: string; batch_no?: string;
  mfg_date?: string; expiry_date?: string; manufacturer?: string; active_ingredient?: string;
}): Promise<string | null> {
  if (!input.batch_no) return null;
  const row = await input.db.prepare('SELECT id FROM product_batches WHERE product_id=? AND batch_no=?')
    .bind(input.product_id, input.batch_no).first<{ id: string }>();
  if (row) { await input.posting.batchState(row.id); return row.id; }
  const id = ulid();
  input.posting.b.add(`INSERT INTO product_batches (id,product_id,batch_no,mfg_date,expiry_date,manufacturer,active_ingredient,quarantined,created_at)
    VALUES (?,?,?,?,?,?,?,0,?)`,
    id, input.product_id, input.batch_no, input.mfg_date ?? null, input.expiry_date ?? null,
    input.manufacturer ?? '', input.active_ingredient ?? '', input.posting.at);
  input.posting.batches.set(`${id}|${input.posting.warehouse_id}`, { batch_id: id, warehouse_id: input.posting.warehouse_id, qty_milli: 0, value_paisa: 0 });
  input.posting.batchesOriginal.set(`${id}|${input.posting.warehouse_id}`, 0);
  return id;
}

/** Grain crops need a stock product; created lazily from the crop name (never a fake price/balance). */
export async function ensureGrainProduct(input: { db: DB; posting: Posting; crop: string; crop_ur: string }): Promise<string> {
  const sku = `GRAIN-${input.crop}`;
  const row = await input.db.prepare('SELECT id FROM products WHERE sku=?').bind(sku).first<{ id: string }>();
  if (row) return row.id;
  const id = ulid();
  input.posting.b.add(`INSERT INTO products (id,name_ur,name_en,slug,category_id,sku,base_unit,purchase_unit,sale_unit,conversion_ratio_milli,grams_per_base_unit,
      track_batch,track_expiry,is_pesticide,purchase_rate_paisa,sale_rate_paisa,show_public_price,public_price_paisa,is_published,is_featured,is_active,
      created_at,created_by,updated_at,version)
    VALUES (?,?,?,?,?,?,?,?,?,1000,1000,0,0,0,0,0,0,0,0,0,1,?,?,?,1)`,
    id, input.crop_ur, input.crop, `grain-${input.crop.toLowerCase()}-${id.slice(-6)}`, `cat-${input.crop.toLowerCase()}`,
    sku, 'kg', 'kg', 'kg', input.posting.at, input.posting.actor.id, input.posting.at);
  return id;
}

export function snapshotBase(business: any, input: {
  number: string; date: string; party: { name: string; phone?: string; address?: string };
  title_ur: string; total_paisa: number; paid_paisa: number; due_paisa: number;
  payment_method: string; note?: string; book_code?: string; provisional?: boolean;
}): DocumentSnapshot {
  return {
    template_version: TEMPLATE_VERSION,
    document_type: input.title_ur,
    number: input.number,
    date: input.date,
    business: {
      name_ur: business.name_ur, name_en: business.name_en,
      location_ur: business.location_ur, phone1: business.phone1, phone2: business.phone2,
      logo_r2_key: business.logo_r2_key, invoice_footer: business.invoice_footer,
      pesticide_licence_no: business.pesticide_licence_no,
      pesticide_licence_expiry: business.pesticide_licence_expiry,
    },
    party: { name: input.party.name, phone: input.party.phone, address: input.party.address },
    title_ur: input.title_ur,
    lines: [], subtotal_paisa: input.total_paisa, extras: [],
    total_paisa: input.total_paisa, paid_paisa: input.paid_paisa, due_paisa: input.due_paisa,
    payment_method: input.payment_method, note: input.note, book_code: input.book_code,
    provisional: input.provisional,
  };
}
