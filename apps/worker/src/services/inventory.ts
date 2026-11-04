/** Parties with opening balances, stock opening/adjustment/count, manual journals, account openings. */
import {
  ulid, lineAmount, fromMilli, manualJournalLines, openingBalanceLines,
  stockAdjustmentLines, formatPKR, type PartyInput, type DocumentSnapshot,
} from '@zt/shared';
import type { AppContext } from '../context.js';
import { BizError, assertPeriodOpen, businessInfo, audit, encryptCnic } from '../context.js';
import { Posting, withPostingRetry, snapshotBase, ensureBatch } from '../posting.js';
import { bookFromProduct, requirePermission, resolveAccount } from './common.js';

export async function postParty(c: AppContext, input: PartyInput) {
  const actor = requirePermission(c, 'parties.write');
  const db = c.get('db')!;
  const cnicEnc = await encryptCnic(c, input.cnic);
  const warnings: string[] = [];
  if (input.phone) {
    const dup = await db.prepare('SELECT id,name_ur FROM parties WHERE phone=? LIMIT 1').bind(input.phone).first<{ name_ur: string }>();
    if (dup) warnings.push(`اسی موبائل نمبر پر پہلے سے فریق موجود ہے: ${dup.name_ur}`);
  }
  const date = input.opening_date ?? new Date().toISOString().slice(0, 10);
  const amount = input.opening_balance_paisa;
  const receivable = input.opening_direction === 'RECEIVABLE';
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, date);
    const id = ulid();
    p.b.add(`INSERT INTO parties (id,name_ur,name_en,phone,village,type,opening_balance_paisa,opening_direction,opening_date,credit_limit_paisa,cnic_enc,notes,is_active,created_at,created_by,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,1)`,
      id, input.name_ur, input.name_en, input.phone, input.village, input.type,
      amount, input.opening_direction, input.opening_date ?? null, input.credit_limit_paisa,
      cnicEnc, input.notes, p.at, actor.id, p.at);
    p.parties.set(id, 0); p.partiesOriginal.set(id, 0);
    if (amount > 0) {
      const gl = receivable ? '1100' : '2000';
      const dir = receivable ? 'DEBIT' : 'CREDIT';
      const journalId = p.journal({ ref_type: 'PARTY_OPENING', ref_id: id,
        memo_ur: `ابتدائی بیلنس — ${input.name_ur}`,
        lines: openingBalanceLines(gl, amount, dir) });
      p.b.add(`INSERT INTO party_opening_balances (id,party_id,amount_paisa,direction,as_of_date,journal_id,created_at)
        VALUES (?,?,?,?,?,?,?)`, ulid(), id, amount, input.opening_direction, date, journalId, p.at);
      p.partyLedger({ party_id: id, book_code: 'GENERAL',
        [receivable ? 'debit_paisa' : 'credit_paisa']: amount,
        ref_type: 'OPENING', ref_id: id, description_ur: 'ابتدائی بیلنس' } as any);
    }
    await p.commit();
    await audit(db, 'CREATE', 'parties', id, { user_id: actor.id, after: { name: input.name_ur, type: input.type } });
    return { id, number: '', warnings };
  });
}

export async function postAccountOpening(c: AppContext, input: {
  account_code: string; amount_paisa: number; as_of_date: string; direction: 'DEBIT' | 'CREDIT';
}) {
  const db = c.get('db')!;
  const actor = c.get('user') ?? { id: 'setup', permissions: ['*'], roles: ['OWNER'], username: 'setup', name: 'Setup', csrf: '' } as any;
  const account = await resolveAccount(db, input.account_code);
  if (input.amount_paisa < 0) throw new BizError(400, 'NEGATIVE_AMOUNT', 'منفی رقم', 'Negative amount');
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.as_of_date);
    const id = ulid();
    const current = await p.accountState(account.id);
    if (input.amount_paisa > 0) {
      const journalId = p.journal({ ref_type: 'ACCOUNT_OPENING', ref_id: id,
        memo_ur: `ابتدائی بیلنس — ${account.name_ur}`,
        lines: openingBalanceLines(account.gl_code, input.amount_paisa, input.direction) });
      p.b.add(`INSERT INTO account_transactions (id,account_id,date,direction,amount_paisa,ref_type,ref_id,description_ur,matched,created_at,created_by)
        VALUES (?,?,?,?,?,'ACCOUNT_OPENING',?,?,0,?,?)`,
        ulid(), account.id, input.as_of_date, input.direction === 'DEBIT' ? 'IN' : 'OUT',
        input.amount_paisa, id, 'ابتدائی بیلنس', p.at, actor.id);
      p.accounts.set(account.id, current + (input.direction === 'DEBIT' ? input.amount_paisa : -input.amount_paisa));
      p.b.add('UPDATE financial_accounts SET opening_balance_paisa=?, opening_date=? WHERE id=?',
        input.amount_paisa, input.as_of_date, account.id);
      void journalId;
    }
    await p.commit();
    return { id, balance_paisa: p.accounts.get(account.id) };
  });
}

export async function postStockOpening(c: AppContext, input: {
  date: string; product_id: string; batch_no?: string; qty_milli: number;
  unit_cost_paisa: number; reason?: string;
}) {
  const actor = requirePermission(c, 'stock.adjust');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const book = await bookFromProduct(db, input.product_id);
  const cost = lineAmount(input.qty_milli, input.unit_cost_paisa);
  const business = await businessInfo(db);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber('ADJUSTMENT');
    const id = ulid();
    await p.stockState(input.product_id);
    const batchId = await ensureBatch({ db, posting: p, product_id: input.product_id, batch_no: input.batch_no });
    if (batchId) await p.batchState(batchId);
    const invAccount = await inventoryAccount(db, book);
    const journalId = p.journal({ ref_type: 'STOCK_OPENING', ref_id: id, memo_ur: `ابتدائی اسٹاک ${number}`,
      lines: manualJournalLines([
        { account_code: invAccount, debit_paisa: cost, credit_paisa: 0, book_code: book },
        { account_code: '3900', debit_paisa: 0, credit_paisa: cost },
      ]) });
    p.b.add(`INSERT INTO stock_openings (id,product_id,batch_id,qty_milli,unit_cost_paisa,date,journal_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`, id, input.product_id, batchId, input.qty_milli,
      input.unit_cost_paisa, input.date, journalId, p.at, actor.id);
    p.stockIn({ product_id: input.product_id, batch_id: batchId, qty_milli: input.qty_milli,
      cost_total_paisa: cost, unit_cost_paisa: input.unit_cost_paisa,
      ref_type: 'STOCK_OPENING', ref_id: id, book_code: book, note: input.reason ?? 'ابتدائی اسٹاک' });
    const snapshot = snapshotBase(business, {
      number, date: input.date, party: { name: '' }, title_ur: 'ابتدائی اسٹاک',
      total_paisa: cost, paid_paisa: 0, due_paisa: 0, payment_method: '', note: input.reason, book_code: book,
    });
    snapshot.lines = [{ label: input.product_id.slice(-6), qty: fromMilli(input.qty_milli),
      rate: formatPKR(input.unit_cost_paisa), amount_paisa: cost }];
    p.document({ type: 'STOCK_OPENING', number, party_id: null, amount_paisa: cost,
      book_code: book, ref_id: id, snapshot });
    await p.commit();
    await audit(db, 'POST', 'stock_openings', id, { user_id: actor.id, after: { qty: input.qty_milli, cost } });
    return { id, number, cost_paisa: cost };
  });
}

async function inventoryAccount(db: any, book: string): Promise<string> {
  // BOOK_MAP inventory GL code via shared constants, resolved through a tiny lookup.
  const { BOOK_MAP } = await import('@zt/shared');
  return BOOK_MAP[book]?.inventory ?? '1200';
}

export async function postStockAdjustment(c: AppContext, input: {
  date: string; product_id: string; batch_id?: string | null;
  delta_milli: number; reason: string; unit_cost_paisa: number;
}) {
  const actor = requirePermission(c, 'stock.adjust');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  if (!input.delta_milli) throw new BizError(400, 'ZERO_ADJUSTMENT', 'تبدیلی صفر ہے', 'Adjustment quantity is zero');
  const book = await bookFromProduct(db, input.product_id);
  const qty = Math.abs(input.delta_milli);
  const cost = lineAmount(qty, input.unit_cost_paisa);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber('ADJUSTMENT');
    const id = ulid();
    await p.stockState(input.product_id);
    if (input.batch_id) await p.batchState(input.batch_id);
    const journalId = p.journal({ ref_type: 'STOCK_ADJUSTMENT', ref_id: id,
      memo_ur: `اسٹاک ایڈجسٹمنٹ ${number}`, reason: input.reason,
      lines: stockAdjustmentLines(input.delta_milli > 0 ? cost : -cost, book as any) });
    p.b.add(`INSERT INTO stock_adjustments (id,number,date,product_id,batch_id,delta_milli,unit_cost_paisa,reason,journal_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, number, input.date, input.product_id,
      input.batch_id ?? null, input.delta_milli, input.unit_cost_paisa, input.reason, journalId, p.at, actor.id);
    if (input.delta_milli > 0) {
      p.stockIn({ product_id: input.product_id, batch_id: input.batch_id ?? null, qty_milli: qty,
        cost_total_paisa: cost, unit_cost_paisa: input.unit_cost_paisa,
        ref_type: 'STOCK_ADJUSTMENT', ref_id: id, book_code: book, note: input.reason });
    } else {
      p.stockOut({ product_id: input.product_id, batch_id: input.batch_id ?? null, qty_milli: qty,
        cost_total_paisa: cost, unit_cost_paisa: input.unit_cost_paisa,
        ref_type: 'STOCK_ADJUSTMENT', ref_id: id, book_code: book, note: input.reason });
    }
    p.summary(book, 'STOCK_ADJUSTMENT', cost, input.delta_milli);
    await p.commit();
    await audit(db, 'POST', 'stock_adjustments', id, { user_id: actor.id, reason: input.reason, after: { delta: input.delta_milli } });
    return { id, number, delta_milli: input.delta_milli };
  });
}

export async function postStockCount(c: AppContext, input: {
  date: string; book_code?: string; reason: string;
  lines: { product_id: string; counted_milli: number }[];
}) {
  const actor = requirePermission(c, 'stock.count');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const rows = await Promise.all(input.lines.map(async (l) => {
    const bal = await db.prepare('SELECT qty_milli,value_paisa FROM stock_balance WHERE product_id=? AND warehouse_id=?')
      .bind(l.product_id, 'wh-main').first<{ qty_milli: number; value_paisa: number }>();
    const system = bal?.qty_milli ?? 0;
    const unit = bal?.qty_milli ? Math.floor((bal?.value_paisa ?? 0) * 1000 / bal.qty_milli) : 0;
    const book = await bookFromProduct(db, l.product_id);
    return { ...l, system, variance: l.counted_milli - system, unit_cost_paisa: unit, book };
  }));
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const id = ulid();
    p.b.add(`INSERT INTO stock_counts (id,date,book_code,status,reason,created_at,created_by)
      VALUES (?,?,?,'POSTED',?,?,?)`, id, input.date, input.book_code ?? null, input.reason, p.at, actor.id);
    for (const r of rows) {
      p.b.add(`INSERT INTO stock_count_lines (id,count_id,product_id,system_milli,counted_milli,variance_milli)
        VALUES (?,?,?,?,?,?)`, ulid(), id, r.product_id, r.system, r.counted_milli, r.variance);
      if (!r.variance) continue;
      await p.stockState(r.product_id);
      const qty = Math.abs(r.variance);
      const cost = lineAmount(qty, r.unit_cost_paisa);
      p.journal({ ref_type: 'STOCK_COUNT', ref_id: id, memo_ur: `اسٹاک گنتی ${input.reason}`,
        lines: stockAdjustmentLines(r.variance > 0 ? cost : -cost, r.book as any), reason: input.reason });
      if (r.variance > 0) p.stockIn({ product_id: r.product_id, batch_id: null, qty_milli: qty,
        cost_total_paisa: cost, unit_cost_paisa: r.unit_cost_paisa,
        ref_type: 'STOCK_COUNT', ref_id: id, book_code: r.book, note: input.reason });
      else p.stockOut({ product_id: r.product_id, batch_id: null, qty_milli: qty,
        cost_total_paisa: cost, unit_cost_paisa: r.unit_cost_paisa,
        ref_type: 'STOCK_COUNT', ref_id: id, book_code: r.book, note: input.reason });
    }
    await p.commit();
    await audit(db, 'POST', 'stock_counts', id, { user_id: actor.id, after: { lines: rows.length } });
    return { id, variances: rows.filter((r) => r.variance).length };
  });
}

export async function postManualJournal(c: AppContext, input: {
  date: string; memo_ur: string; reason: string;
  lines: { account_code: string; debit_paisa: number; credit_paisa: number; party_id?: string | null; book_code?: string | null }[];
}) {
  const actor = requirePermission(c, 'accounting.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const id = ulid();
    const journalId = p.journal({ ref_type: 'MANUAL', ref_id: id, memo_ur: input.memo_ur,
      reason: input.reason, lines: manualJournalLines(input.lines) });
    await p.commit();
    await audit(db, 'POST', 'journal_entries', journalId, { user_id: actor.id, reason: input.reason, after: input.lines });
    return { id: journalId };
  });
}
