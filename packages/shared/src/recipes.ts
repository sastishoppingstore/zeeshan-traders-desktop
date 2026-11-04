/**
 * Posting recipes. Pure functions -> balanced journal lines (H4).
 * The Worker posting engine turns these into SQL inside ONE db.batch().
 * Every recipe is unit-tested in tests/recipes.test.ts (sum debit == sum credit).
 */
import type { Paisa } from './money.js';
import { assertPaisa } from './money.js';
import { BOOK_MAP, MONEY_MAP, type BookCode } from './constants.js';

export interface JournalLine {
  account_code: string;
  debit_paisa: Paisa;
  credit_paisa: Paisa;
  party_id?: string | null;
  book_code?: string | null;
  memo?: string;
}

export interface JournalSpec {
  date: string;
  ref_type: string;
  ref_id: string;
  memo_ur: string;
  lines: JournalLine[];
}

function dr(account_code: string, amount: Paisa, extra: Partial<JournalLine> = {}): JournalLine {
  return { account_code, debit_paisa: assertPaisa(amount, 'debit'), credit_paisa: 0, ...extra };
}
function cr(account_code: string, amount: Paisa, extra: Partial<JournalLine> = {}): JournalLine {
  return { account_code, debit_paisa: 0, credit_paisa: assertPaisa(amount, 'credit'), ...extra };
}

export function assertBalanced(lines: JournalLine[]): void {
  if (!lines.length) throw new Error('journal has no lines');
  let d = 0n, c = 0n;
  for (const l of lines) {
    assertPaisa(l.debit_paisa, 'debit');
    assertPaisa(l.credit_paisa, 'credit');
    if (l.debit_paisa < 0 || l.credit_paisa < 0) throw new Error('negative journal amount');
    if (l.debit_paisa > 0 && l.credit_paisa > 0) throw new Error('both debit and credit on one line');
    if (l.debit_paisa === 0 && l.credit_paisa === 0) throw new Error('zero journal line');
    d += BigInt(l.debit_paisa);
    c += BigInt(l.credit_paisa);
  }
  if (d !== c) throw new Error(`UNBALANCED JOURNAL: debit=${d} credit=${c}`);
}

/** GL code for a money book id ('CASH', 'JAZZ', 'MEEZAN', 'UBL'). */
export function moneyGL(accountCode: string): string {
  return MONEY_MAP[accountCode]?.gl ?? '1000';
}

export function bookGL(book: BookCode) {
  const b = BOOK_MAP[book];
  if (!b) throw new Error(`unknown book ${book}`);
  return { sales: b.sales, cogs: b.cogs, inventory: b.inventory };
}

export interface SaleRecipeInput {
  book: BookCode;
  total: Paisa;
  cost: Paisa;
  payments: { account_id: string; amount_paisa: Paisa }[]; // account_id is money-book code for journal purposes
  credit: Paisa; // due -> receivable
  party_id: string;
  discount?: Paisa;
}

/** Cash/part/credit sale: Dr money + receivable | Cr sales; Dr COGS | Cr inventory. */
export function saleLines(i: SaleRecipeInput): JournalLine[] {
  const { sales, cogs, inventory } = bookGL(i.book);
  const lines: JournalLine[] = [];
  const net = i.total - (i.discount ?? 0);
  assertPaisa(net, 'sale net');
  for (const p of i.payments) {
    if (p.amount_paisa > 0) lines.push(dr(moneyGL(p.account_id), p.amount_paisa, { memo: 'Sale receipt' }));
  }
  if (i.credit > 0) lines.push(dr('1100', i.credit, { party_id: i.party_id, book_code: i.book, memo: 'Credit sale / ادھار' }));
  lines.push(cr(sales, net, { book_code: i.book }));
  if (i.cost > 0) {
    lines.push(dr(cogs, i.cost, { book_code: i.book }));
    lines.push(cr(inventory, i.cost, { book_code: i.book }));
  }
  assertBalanced(lines);
  return lines;
}

export interface PurchaseRecipeInput {
  book: BookCode;
  total: Paisa; // includes landed costs that are capitalised
  payments: { account_id: string; amount_paisa: Paisa }[];
  credit: Paisa;
  party_id: string;
  expensed_extras?: Paisa; // freight/loading expensed per setting (Dr expense, Cr account)
}

/** Purchase: Dr inventory (+/- expensed extras) | Cr money + payable. */
export function purchaseLines(i: PurchaseRecipeInput): JournalLine[] {
  const { inventory } = bookGL(i.book);
  const lines: JournalLine[] = [];
  lines.push(dr(inventory, i.total, { book_code: i.book }));
  if (i.expensed_extras) lines.push(dr('6010', i.expensed_extras, { book_code: i.book }));
  for (const p of i.payments) {
    if (p.amount_paisa > 0) lines.push(cr(moneyGL(p.account_id), p.amount_paisa, { memo: 'Purchase payment' }));
  }
  if (i.credit > 0) lines.push(cr('2000', i.credit, { party_id: i.party_id, book_code: i.book, memo: 'ادھار خرید' }));
  assertBalanced(lines);
  return lines;
}

/** Customer receipt: Dr account | Cr receivable — NOT revenue. */
export function receiptLines(account: string, amount: Paisa, party_id: string, book?: string): JournalLine[] {
  const lines = [dr(moneyGL(account), amount), cr('1100', amount, { party_id, book_code: book ?? null })];
  assertBalanced(lines);
  return lines;
}

/** Supplier/farmer/employee payment: Dr payable | Cr account — NOT a purchase. */
export function paymentLines(account: string, amount: Paisa, party_id: string, book?: string): JournalLine[] {
  const lines = [dr('2000', amount, { party_id, book_code: book ?? null }), cr(moneyGL(account), amount)];
  assertBalanced(lines);
  return lines;
}

/** Transfer between money books: Dr destination | Cr source — NOT income/expense. */
export function transferLines(from: string, to: string, amount: Paisa): JournalLine[] {
  if (from === to) throw new Error('transfer source and destination must differ');
  const lines = [dr(moneyGL(to), amount), cr(moneyGL(from), amount)];
  assertBalanced(lines);
  return lines;
}

export function expenseLines(account: string, amount: Paisa, gl: string, book: string = 'GENERAL'): JournalLine[] {
  const lines = [dr(gl, amount, { book_code: book }), cr(moneyGL(account), amount)];
  assertBalanced(lines);
  return lines;
}

/** JazzCash/bank charge: fee is an expense, not a reduction of the principal. */
export function chargeLines(account: string, fee: Paisa): JournalLine[] {
  return expenseLines(account, fee, '6070', 'GENERAL');
}

export function salaryLines(account: string, gross: Paisa, advanceRecovered: Paisa, deductions: Paisa, net: Paisa): JournalLine[] {
  if (gross !== net + advanceRecovered + deductions) throw new Error('salary arithmetic does not balance');
  const lines: JournalLine[] = [dr('6080', gross, { book_code: 'PAYROLL' })];
  if (advanceRecovered) lines.push(cr('1150', advanceRecovered, { book_code: 'PAYROLL' }));
  if (deductions) lines.push(cr('2100', deductions, { book_code: 'PAYROLL' }));
  lines.push(cr(moneyGL(account), net));
  assertBalanced(lines);
  return lines;
}

/** Sale return: reverse revenue and restore inventory at ORIGINAL cost. */
export function saleReturnLines(input: {
  refund: Paisa; cost: Paisa; account?: string; creditToKhata?: boolean;
  party_id: string; book: BookCode;
}): JournalLine[] {
  const { sales, cogs, inventory } = bookGL(input.book);
  const lines: JournalLine[] = [dr('4900', input.refund, { book_code: input.book })];
  if (input.creditToKhata) lines.push(cr('1100', input.refund, { party_id: input.party_id, book_code: input.book }));
  else lines.push(cr(moneyGL(input.account ?? 'CASH'), input.refund));
  lines.push(dr(inventory, input.cost, { book_code: input.book }));
  lines.push(cr(cogs, input.cost, { book_code: input.book }));
  assertBalanced(lines);
  return lines;
}

export function purchaseReturnLines(input: {
  amount: Paisa; account?: string; creditToKhata?: boolean; party_id: string; book: BookCode;
}): JournalLine[] {
  const { inventory } = bookGL(input.book);
  const lines: JournalLine[] = [];
  if (input.creditToKhata) lines.push(dr('2000', input.amount, { party_id: input.party_id, book_code: input.book }));
  else lines.push(dr(moneyGL(input.account ?? 'CASH'), input.amount));
  lines.push(cr(inventory, input.amount, { book_code: input.book }));
  assertBalanced(lines);
  return lines;
}

/** Stock adjustment: gain Dr inventory | Cr 7000; loss Dr 7000 | Cr inventory. */
export function stockAdjustmentLines(deltaPaisa: Paisa, book: BookCode): JournalLine[] {
  const { inventory } = bookGL(book);
  const abs = Math.abs(assertPaisa(deltaPaisa, 'delta'));
  const lines = deltaPaisa >= 0
    ? [dr(inventory, abs, { book_code: book }), cr('7000', abs, { book_code: book })]
    : [dr('7000', abs, { book_code: book }), cr(inventory, abs, { book_code: book })];
  assertBalanced(lines);
  return lines;
}

/** Opening balance: Dr asset | Cr opening equity (or Dr opening equity | Cr liability). */
export function openingBalanceLines(gl: string, amount: Paisa, direction: 'DEBIT' | 'CREDIT'): JournalLine[] {
  const lines = direction === 'DEBIT'
    ? [dr(gl, amount), cr('3900', amount)]
    : [dr('3900', amount), cr(gl, amount)];
  assertBalanced(lines);
  return lines;
}

/** Manual balanced journal (accounting screen). */
export function manualJournalLines(lines: JournalLine[]): JournalLine[] {
  assertBalanced(lines);
  return lines;
}

export const RECIPE_NAMES = [
  'sale', 'purchase', 'receipt', 'payment', 'transfer', 'expense', 'charge',
  'salary', 'sale_return', 'purchase_return', 'stock_adjustment', 'opening_balance', 'manual',
] as const;
