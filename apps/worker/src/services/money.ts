/** Money books, receipts/payments with allocation, transfers, JazzCash in/out, expenses, payroll. */
import {
  ulid, receiptLines, paymentLines, transferLines, chargeLines, expenseLines,
  salaryLines, manualJournalLines, sumPaisa, type ReceiptInput, type PaymentInput,
} from '@zt/shared';
import type { DB } from '../db.js';
import type { AppContext } from '../context.js';
import { BizError, assertPeriodOpen, businessInfo, idempotentResult, audit } from '../context.js';
import { Posting, withPostingRetry, resolveParty, snapshotBase } from '../posting.js';
import { resolveAccount, resolvePayments, requirePermission, setting } from './common.js';

async function buildAllocations(db: DB, party_id: string, type: 'SALE' | 'PURCHASE', amount: number, mode: 'AUTO' | 'MANUAL' | 'ADVANCE', manual?: { invoice_id: string; amount_paisa: number }[]) {
  if (mode === 'ADVANCE') return { rows: [] as { invoice_id: string; amount_paisa: number }[], advance: amount };
  if (mode === 'MANUAL') {
    const rows = (manual ?? []).filter((x) => x.amount_paisa > 0);
    const sum = sumPaisa(rows.map((r) => r.amount_paisa));
    if (sum > amount) throw new BizError(400, 'ALLOCATION_EXCEEDS', 'الاٹمنٹ رقم سے زیادہ ہے', 'Allocations exceed the receipt amount');
    return { rows, advance: amount - sum };
  }
  const table = type === 'SALE' ? 'sales' : 'purchases';
  const invoices = await db.prepare(`SELECT id,due_paisa FROM ${table} WHERE party_id=? AND status='POSTED' AND due_paisa>0 ORDER BY date,number LIMIT 50`)
    .bind(party_id).all<{ id: string; due_paisa: number }>();
  const rows: { invoice_id: string; amount_paisa: number }[] = [];
  let left = amount;
  for (const inv of invoices) {
    if (left <= 0) break;
    const allocated = await db.prepare(`SELECT COALESCE(SUM(amount_paisa),0) s FROM payment_allocations WHERE invoice_type=? AND invoice_id=?`)
      .bind(type, inv.id).first<{ s: number }>();
    const remaining = inv.due_paisa - (allocated?.s ?? 0);
    if (remaining <= 0) continue;
    const take = Math.min(remaining, left);
    rows.push({ invoice_id: inv.id, amount_paisa: take });
    left -= take;
  }
  return { rows, advance: left };
}

export async function postReceipt(c: AppContext, input: ReceiptInput, asPayment = false) {
  const actor = requirePermission(c, asPayment ? 'payments.post' : 'receipts.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const account = await resolveAccount(db, input.account_id);
  const party = await db.prepare('SELECT id,name_ur,phone,village FROM parties WHERE id=?').bind(input.party_id).first<any>();
  if (!party) throw new BizError(400, 'PARTY_NOT_FOUND', 'فریق نہیں ملا', 'Party not found');
  const { rows, advance } = await buildAllocations(db, input.party_id, asPayment ? 'PURCHASE' : 'SALE',
    input.amount_paisa, input.allocate, input.allocations);
  const business = await businessInfo(db);

  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(asPayment ? 'PAYMENT' : 'RECEIPT');
    const id = ulid();
    await p.partyState(input.party_id);
    await p.accountState(account.id);
    const journalId = p.journal({
      ref_type: asPayment ? 'PAYMENT' : 'RECEIPT', ref_id: id,
      memo_ur: `${asPayment ? 'ادائیگی' : 'وصولی'} ${number} — ${party.name_ur}`,
      lines: asPayment
        ? paymentLines(account.code, input.amount_paisa, input.party_id)
        : receiptLines(account.code, input.amount_paisa, input.party_id),
    });
    if (asPayment) {
      p.b.add(`INSERT INTO payments (id,number,date,party_id,payee_type,account_id,amount_paisa,reference,note,allocate_mode,advance_paisa,journal_id,status,snapshot_json,idempotency_key,provisional,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'POSTED','{}',?,0,?,?)`,
        id, number, input.date, input.party_id, (input as PaymentInput).payee_type ?? 'SUPPLIER',
        account.id, input.amount_paisa, input.reference, input.note, input.allocate, advance,
        journalId, input.idempotency_key ?? null, p.at, actor.id);
    } else {
      p.b.add(`INSERT INTO receipts (id,number,date,party_id,account_id,amount_paisa,reference,note,allocate_mode,advance_paisa,journal_id,status,snapshot_json,idempotency_key,provisional,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'POSTED','{}',?,0,?,?)`,
        id, number, input.date, input.party_id, account.id, input.amount_paisa,
        input.reference, input.note, input.allocate, advance, journalId,
        input.idempotency_key ?? null, p.at, actor.id);
    }
    for (const r of rows) {
      p.b.add(`INSERT INTO payment_allocations (id,${asPayment ? 'payment_id' : 'receipt_id'},invoice_id,invoice_type,amount_paisa,created_at)
        VALUES (?,?,?,?,?,?)`, ulid(), id, r.invoice_id, asPayment ? 'PURCHASE' : 'SALE', r.amount_paisa, p.at);
    }
    p.accountTxn({ account_id: account.id, direction: asPayment ? 'OUT' : 'IN',
      amount_paisa: input.amount_paisa, ref_type: asPayment ? 'PAYMENT' : 'RECEIPT',
      ref_id: id, description_ur: `${asPayment ? 'ادائیگی' : 'وصولی'} ${number}` });
    p.partyLedger({ party_id: input.party_id, book_code: 'GENERAL',
      [asPayment ? 'debit_paisa' : 'credit_paisa']: input.amount_paisa,
      ref_type: asPayment ? 'PAYMENT' : 'RECEIPT', ref_id: id,
      description_ur: `${asPayment ? 'ادائیگی' : 'وصولی'} ${number}` } as any);
    p.summary('GENERAL', asPayment ? 'CASH_OUT' : 'CASH_IN', input.amount_paisa);
    p.summary('GENERAL', asPayment ? 'PAYABLE_PAID' : 'RECEIVABLE_COLLECTED', input.amount_paisa);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party: { name: party.name_ur, phone: party.phone, address: party.village },
      title_ur: asPayment ? 'ادائیگی رسید' : 'وصولی رسید',
      total_paisa: input.amount_paisa, paid_paisa: input.amount_paisa, due_paisa: 0,
      payment_method: account.name_ur, note: `${input.note} ${input.reference}`.trim(),
    });
    snapshot.lines = [
      ...rows.map((r) => ({ label: `الاٹمنٹ ${r.invoice_id.slice(-6)}`, qty: '', rate: '', amount_paisa: r.amount_paisa })),
      ...(advance ? [{ label: 'ایڈوانس / Advance', qty: '', rate: '', amount_paisa: advance }] : []),
    ];
    p.document({ type: asPayment ? 'PAYMENT' : 'RECEIPT', number, party_id: input.party_id,
      amount_paisa: input.amount_paisa, ref_id: id, snapshot });
    if (input.idempotency_key) p.syncOperation({ key: input.idempotency_key,
      device_id: actor.device_id ?? 'server', type: asPayment ? 'PAYMENT' : 'RECEIPT',
      payload: input, local_time: p.at, doc_id: id, number });
    await p.commit();
    await audit(db, 'POST', asPayment ? 'payments' : 'receipts', id,
      { user_id: actor.id, after: { number, amount: input.amount_paisa, advance } });
    return { id, number, advance_paisa: advance, allocations: rows };
  });
}

export async function postTransfer(c: AppContext, input: {
  date: string; from_account_id: string; to_account_id: string; amount_paisa: number; note?: string; idempotency_key?: string;
}) {
  const actor = requirePermission(c, 'transfers.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const from = await resolveAccount(db, input.from_account_id);
  const to = await resolveAccount(db, input.to_account_id);
  if (from.id === to.id) throw new BizError(400, 'SAME_ACCOUNT', 'منتقلی کے دونوں اکاؤنٹس ایک ہی ہیں', 'Source and destination must differ');
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const business = await businessInfo(db);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber('TRANSFER');
    const id = ulid();
    await p.accountState(from.id); await p.accountState(to.id);
    const journalId = p.journal({ ref_type: 'TRANSFER', ref_id: id, memo_ur: `ٹرانسفر ${number}`,
      lines: transferLines(from.code, to.code, input.amount_paisa) });
    p.b.add(`INSERT INTO transfers (id,number,date,from_account_id,to_account_id,amount_paisa,note,journal_id,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, id, number, input.date, from.id, to.id,
      input.amount_paisa, input.note ?? '', journalId, p.at, actor.id);
    p.accountTxn({ account_id: from.id, direction: 'OUT', amount_paisa: input.amount_paisa,
      ref_type: 'TRANSFER', ref_id: id, description_ur: `${to.name_ur} کو ٹرانسفر` });
    p.accountTxn({ account_id: to.id, direction: 'IN', amount_paisa: input.amount_paisa,
      ref_type: 'TRANSFER', ref_id: id, description_ur: `${from.name_ur} سے ٹرانسفر` });
    const snapshot = snapshotBase(business, {
      number, date: input.date, party: { name: `${from.name_ur} ← ${to.name_ur}` },
      title_ur: 'رقم منتقلی / Transfer voucher', total_paisa: input.amount_paisa,
      paid_paisa: input.amount_paisa, due_paisa: 0,
      payment_method: `${from.name_ur} → ${to.name_ur}`, note: input.note,
    });
    p.document({ type: 'TRANSFER', number, party_id: null, amount_paisa: input.amount_paisa, ref_id: id, snapshot });
    await p.commit();
    const balances = {
      from: await db.prepare('SELECT balance_paisa FROM account_balance WHERE account_id=?').bind(from.id).first<{ balance_paisa: number }>(),
      to: await db.prepare('SELECT balance_paisa FROM account_balance WHERE account_id=?').bind(to.id).first<{ balance_paisa: number }>(),
    };
    await audit(db, 'POST', 'transfers', id, { user_id: actor.id, after: { number, amount: input.amount_paisa } });
    return { id, number, from_balance_paisa: balances.from?.balance_paisa ?? 0, to_balance_paisa: balances.to?.balance_paisa ?? 0 };
  });
}

export async function postJazz(c: AppContext, input: {
  date: string; direction: 'IN' | 'OUT'; amount_paisa: number; counterparty: string;
  mobile: string; tid: string; fee_paisa: number;
  purpose: 'SALE' | 'COLLECTION' | 'SUPPLIER_PAYMENT' | 'OTHER';
  party_id?: string | null; note: string;
}) {
  const actor = requirePermission(c, input.direction === 'IN' ? 'receipts.post' : 'payments.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const account = await resolveAccount(db, 'JAZZ');
  const business = await businessInfo(db);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(input.direction === 'IN' ? 'RECEIPT' : 'PAYMENT');
    const id = ulid();
    await p.accountState(account.id);
    const party = await resolveParty({ db, posting: p, party_id: input.party_id, name: input.counterparty,
      phone: input.mobile, type: input.direction === 'IN' ? 'CUSTOMER' : 'SUPPLIER' });
    const lines = input.direction === 'IN'
      ? receiptLines(account.code, input.amount_paisa, party.id)
      : paymentLines(account.code, input.amount_paisa, party.id);
    if (input.fee_paisa > 0) lines.push(...chargeLines(account.code, input.fee_paisa));
    const journalId = p.journal({ ref_type: 'JAZZCASH', ref_id: id,
      memo_ur: `جاز کیش ${input.direction === 'IN' ? 'رقم اِن' : 'رقم آؤٹ'} ${number} — ${input.counterparty}`, lines });
    p.b.add(`INSERT INTO ${input.direction === 'IN' ? 'receipts' : 'payments'} (id,number,date,party_id,${input.direction === 'OUT' ? 'payee_type,' : ''}account_id,amount_paisa,reference,note,allocate_mode,advance_paisa,journal_id,status,snapshot_json,created_at,created_by)
      VALUES (?,?,?,?,${input.direction === 'OUT' ? '?,' : ''}?,?,?,?,'ADVANCE',?,?,'POSTED','{}',?,?)`,
      id, number, input.date, party.id,
      ...(input.direction === 'OUT' ? ['SUPPLIER'] : []),
      account.id, input.amount_paisa, input.tid, input.note, journalId, input.amount_paisa, p.at, actor.id);
    p.accountTxn({ account_id: account.id, direction: input.direction, amount_paisa: input.amount_paisa,
      ref_type: 'JAZZCASH', ref_id: id, description_ur: `جاز کیش ${input.direction} ${input.tid}` });
    if (input.fee_paisa > 0) {
      p.accountTxn({ account_id: account.id, direction: 'OUT', amount_paisa: input.fee_paisa,
        ref_type: 'JAZZCASH_FEE', ref_id: id, description_ur: 'جاز کیش چارجز' });
      p.summary('GENERAL', 'EXPENSE', input.fee_paisa);
    }
    p.partyLedger({ party_id: party.id, book_code: 'GENERAL',
      [input.direction === 'IN' ? 'credit_paisa' : 'debit_paisa']: input.amount_paisa,
      ref_type: 'JAZZCASH', ref_id: id, description_ur: `جاز کیش ${input.direction}` } as any);
    p.summary('GENERAL', input.direction === 'IN' ? 'CASH_IN' : 'CASH_OUT', input.amount_paisa);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party: { name: input.counterparty, phone: input.mobile },
      title_ur: `جاز کیش ${input.direction === 'IN' ? 'رقم اِن' : 'رقم آؤٹ'}`,
      total_paisa: input.amount_paisa, paid_paisa: input.amount_paisa, due_paisa: 0,
      payment_method: account.name_ur, note: `TID: ${input.tid} ${input.note}`,
    });
    snapshot.lines = [{ label: input.purpose, qty: '', rate: '', amount_paisa: input.amount_paisa }];
    if (input.fee_paisa) snapshot.extras = [{ label: 'چارجز / Fee', amount_paisa: -input.fee_paisa }];
    p.document({ type: 'JAZZCASH', number, party_id: party.id, amount_paisa: input.amount_paisa, ref_id: id, snapshot });
    await p.commit();
    await audit(db, 'POST', 'jazzcash', id, { user_id: actor.id, after: { number, direction: input.direction } });
    return { id, number, fee_paisa: input.fee_paisa };
  });
}

export async function postExpense(c: AppContext, input: {
  date: string; category_code: string; vendor: string; amount_paisa: number;
  account_id: string; note: string; idempotency_key?: string;
}) {
  const actor = requirePermission(c, 'expenses.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const cat = await db.prepare('SELECT id,name_ur,gl_code,group_code FROM expense_categories WHERE code=? OR id=?')
    .bind(input.category_code, input.category_code).first<any>();
  if (!cat) throw new BizError(400, 'CATEGORY_NOT_FOUND', 'خرچے کا زمرہ نہیں ملا', 'Expense category not found');
  const account = await resolveAccount(db, input.account_id);
  const business = await businessInfo(db);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber('EXPENSE');
    const id = ulid();
    await p.accountState(account.id);
    const journalId = p.journal({ ref_type: 'EXPENSE', ref_id: id, memo_ur: `خرچہ ${number} — ${cat.name_ur}`,
      lines: expenseLines(account.code, input.amount_paisa, cat.gl_code, cat.group_code) });
    p.b.add(`INSERT INTO expenses (id,number,date,category_id,vendor,amount_paisa,account_id,note,journal_id,status,snapshot_json,idempotency_key,provisional,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,'POSTED','{}',?,0,?,?)`,
      id, number, input.date, cat.id, input.vendor, input.amount_paisa, account.id,
      input.note, journalId, input.idempotency_key ?? null, p.at, actor.id);
    p.accountTxn({ account_id: account.id, direction: 'OUT', amount_paisa: input.amount_paisa,
      ref_type: 'EXPENSE', ref_id: id, description_ur: `خرچہ ${number}` });
    p.summary(cat.group_code, 'EXPENSE', input.amount_paisa);
    p.summary('GENERAL', 'CASH_OUT', input.amount_paisa);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party: { name: input.vendor || cat.name_ur },
      title_ur: 'خرچہ واؤچر', total_paisa: input.amount_paisa,
      paid_paisa: input.amount_paisa, due_paisa: 0,
      payment_method: account.name_ur, note: input.note, book_code: cat.group_code,
    });
    snapshot.lines = [{ label: cat.name_ur, qty: '', rate: '', amount_paisa: input.amount_paisa }];
    p.document({ type: 'EXPENSE', number, party_id: null, amount_paisa: input.amount_paisa,
      book_code: cat.group_code, ref_id: id, snapshot });
    if (input.idempotency_key) p.syncOperation({ key: input.idempotency_key,
      device_id: actor.device_id ?? 'server', type: 'EXPENSE', payload: input,
      local_time: p.at, doc_id: id, number });
    await p.commit();
    await audit(db, 'POST', 'expenses', id, { user_id: actor.id, after: { number, amount: input.amount_paisa } });
    return { id, number };
  });
}

export async function postAdvance(c: AppContext, input: { employee_id: string; date: string; amount_paisa: number; account_id: string; note: string }) {
  const actor = requirePermission(c, 'employees.write');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const account = await resolveAccount(db, input.account_id);
  const emp = await db.prepare('SELECT id,name FROM employees WHERE id=?').bind(input.employee_id).first<{ id: string; name: string }>();
  if (!emp) throw new BizError(404, 'EMPLOYEE_NOT_FOUND', 'ملازم نہیں ملا', 'Employee not found');
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const id = ulid();
    await p.accountState(account.id);
    const journalId = p.journal({ ref_type: 'EMPLOYEE_ADVANCE', ref_id: id, memo_ur: `ایڈوانس ${emp.name}`,
      lines: manualJournalLines([
        { account_code: '1150', debit_paisa: input.amount_paisa, credit_paisa: 0, book_code: 'PAYROLL' },
        { account_code: account.gl_code, debit_paisa: 0, credit_paisa: input.amount_paisa },
      ]) });
    p.b.add(`INSERT INTO employee_advances (id,employee_id,date,amount_paisa,recovered_paisa,account_id,note,journal_id,created_at)
      VALUES (?,?,?,?,0,?,?,?,?)`, id, input.employee_id, input.date, input.amount_paisa,
      account.id, input.note, journalId, p.at);
    p.accountTxn({ account_id: account.id, direction: 'OUT', amount_paisa: input.amount_paisa,
      ref_type: 'EMPLOYEE_ADVANCE', ref_id: id, description_ur: `ایڈوانس ${emp.name}` });
    p.summary('PAYROLL', 'ADVANCE', input.amount_paisa);
    await p.commit();
    return { id };
  });
}

export async function postPayroll(c: AppContext, input: {
  ym: string; pay_date: string; account_id: string;
  rows: { employee_id: string; gross_paisa: number; advance_recovered_paisa: number; deductions_paisa: number }[];
}) {
  const actor = requirePermission(c, 'payroll.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.pay_date);
  const account = await resolveAccount(db, input.account_id);
  for (const r of input.rows) {
    const exists = await db.prepare('SELECT id FROM salary_records WHERE employee_id=? AND ym=?').bind(r.employee_id, input.ym).first();
    if (exists) throw new BizError(409, 'DUPLICATE_SALARY', 'اس مہینے کی تنخواہ پہلے ہی پوسٹ ہو چکی ہے؛ درستی ریورسل سے کریں', 'Salary for this employee/month already posted');
    if (r.gross_paisa < r.advance_recovered_paisa + r.deductions_paisa) {
      throw new BizError(400, 'SALARY_ARITHMETIC', 'کٹوتیاں تنخواہ سے زیادہ ہیں', 'Deductions exceed gross salary');
    }
  }
  const business = await businessInfo(db);
  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.pay_date);
    await p.accountState(account.id);
    const numbers = await p.reserveNumbers('SALARY', input.rows.length);
    const posted: { id: string; number: string; net_paisa: number }[] = [];
    for (let ri = 0; ri < input.rows.length; ri++) {
      const r = input.rows[ri];
      const number = numbers[ri];
      const id = ulid();
      const net = r.gross_paisa - r.advance_recovered_paisa - r.deductions_paisa;
      const emp = await db.prepare('SELECT name FROM employees WHERE id=?').bind(r.employee_id).first<{ name: string }>();
      const journalId = p.journal({ ref_type: 'SALARY', ref_id: id, memo_ur: `تنخواہ ${input.ym} — ${emp?.name ?? ''}`,
        lines: salaryLines(account.code, r.gross_paisa, r.advance_recovered_paisa, r.deductions_paisa, net) });
      p.b.add(`INSERT INTO salary_records (id,number,employee_id,ym,pay_date,gross_paisa,advance_recovered_paisa,deductions_paisa,net_paisa,account_id,status,journal_id,snapshot_json,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,'POSTED',?,'{}',?,?)`,
        id, number, r.employee_id, input.ym, input.pay_date, r.gross_paisa,
        r.advance_recovered_paisa, r.deductions_paisa, net, account.id, journalId, p.at, actor.id);
      p.accountTxn({ account_id: account.id, direction: 'OUT', amount_paisa: net,
        ref_type: 'SALARY', ref_id: id, description_ur: `تنخواہ ${number}` });
      p.summary('PAYROLL', 'EXPENSE', r.gross_paisa);
      p.summary('PAYROLL', 'SALARY_NET', net);
      const snapshot = snapshotBase(business, {
        number, date: input.pay_date, party: { name: emp?.name ?? '' }, title_ur: 'تنخواہ پرچی',
        total_paisa: r.gross_paisa, paid_paisa: net, due_paisa: 0,
        payment_method: account.name_ur, note: `ماہ ${input.ym}`, book_code: 'PAYROLL',
      });
      snapshot.lines = [{ label: 'بنیادی تنخواہ', qty: '', rate: '', amount_paisa: r.gross_paisa }];
      snapshot.extras = [
        { label: 'ایڈوانس وصولی', amount_paisa: -r.advance_recovered_paisa },
        { label: 'دیگر کٹوتیاں', amount_paisa: -r.deductions_paisa },
      ].filter((x) => x.amount_paisa);
      p.document({ type: 'SALARY', number, party_id: null, amount_paisa: net,
        book_code: 'PAYROLL', ref_id: id, snapshot });
      posted.push({ id, number, net_paisa: net });
    }
    await p.commit();
    await audit(db, 'POST', 'payroll', input.ym, { user_id: actor.id, after: posted });
    return { posted };
  });
}

export async function postReconciliation(c: AppContext, input: {
  account_id: string; period: string; statement_balance_paisa: number;
  matched_txn_ids: string[]; note: string;
}) {
  const actor = requirePermission(c, 'reconcile.write');
  const db = c.get('db')!;
  const account = await resolveAccount(db, input.account_id);
  const ledger = await db.prepare('SELECT balance_paisa FROM account_balance WHERE account_id=?').bind(account.id).first<{ balance_paisa: number }>();
  const difference = input.statement_balance_paisa - (ledger?.balance_paisa ?? 0);
  const id = ulid();
  await db.prepare(`INSERT INTO account_reconciliations (id,account_id,period,statement_balance_paisa,ledger_balance_paisa,difference_paisa,note,created_at,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,period) DO UPDATE SET statement_balance_paisa=excluded.statement_balance_paisa,
      difference_paisa=excluded.difference_paisa, note=excluded.note, created_at=excluded.created_at`).bind(
    id, account.id, input.period, input.statement_balance_paisa, ledger?.balance_paisa ?? 0,
    difference, input.note, new Date().toISOString(), actor.id).run();
  for (const txnId of input.matched_txn_ids) {
    await db.prepare('UPDATE account_transactions SET matched=1 WHERE id=? AND account_id=?').bind(txnId, account.id).run();
  }
  await audit(db, 'RECONCILE', 'account_reconciliations', id, { user_id: actor.id, after: { difference } });
  return { id, difference_paisa: difference, ledger_balance_paisa: ledger?.balance_paisa ?? 0 };
}
