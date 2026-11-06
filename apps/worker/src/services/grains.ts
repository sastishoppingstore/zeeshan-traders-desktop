/** Seven independent grain modules: weighment arithmetic, lots, purchases, sales, reconciliation. */
import {
  netWeight, ratePerMaundToRatePerKg, lineAmount, formatMaund, fromMilli,
  ulid, purchaseLines, saleLines, cogsAtWeightedAverage, BOOK_MAP,
  type GrainPurchaseInput, type GrainSaleInput, type DocumentSnapshot, formatPKR,
} from '@zt/shared';
import type { AppContext } from '../context.js';
import type { DB } from '../db.js';
import { BizError, assertPeriodOpen, businessInfo, idempotentResult, audit } from '../context.js';
import { Posting, withPostingRetry, resolveParty, ensureGrainProduct, snapshotBase } from '../posting.js';
import { resolvePayments, journalPayments, paymentMethod, setting, requirePermission } from './common.js';

async function ratePerKg(c: AppContext, basis: 'PER_MAUND' | 'PER_KG', ratePaisa: number): Promise<{ perKg: number; maundKg: number }> {
  if (basis === 'PER_KG') return { perKg: ratePaisa, maundKg: 0 };
  const confirmed = (await setting<boolean>(c, 'maund_confirmed')) ?? false;
  const maundKg = (await setting<number>(c, 'maund_kg')) ?? 0;
  if (!confirmed || !Number.isInteger(maundKg) || maundKg <= 0) {
    throw new BizError(409, 'MAUND_NOT_CONFIRMED', 'من کے کلو مالک کی تصدیق کے بغیر وزن کی خرید ممکن نہیں (ترتیبات میں درج کریں)', 'Maund kg must be confirmed by the owner in Settings before per-maund rates');
  }
  return { perKg: ratePerMaundToRatePerKg(ratePaisa, maundKg), maundKg };
}

export async function lotBalance(db: DB, lot_id: string): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN net_grams ELSE -net_grams END),0) AS bal
    FROM grain_weighments WHERE lot_id=?`).bind(lot_id).first<{ bal: number }>();
  return row?.bal ?? 0;
}

async function ensureLot(c: AppContext, p: Posting, crop: string, lot_no: string | undefined, grade: string, date: string): Promise<string> {
  const db = c.get('db')!;
  if (lot_no) {
    const row = await db.prepare('SELECT id FROM grain_lots WHERE crop=? AND lot_no=?').bind(crop, lot_no).first<{ id: string }>();
    if (row) return row.id;
    const id = ulid();
    p.b.add('INSERT INTO grain_lots (id,crop,lot_no,grade,opened_at,status,notes) VALUES (?,?,?,?,?,\'OPEN\',\'\')',
      id, crop, lot_no, grade, date);
    return id;
  }
  const id = ulid();
  const auto = `LOT-${crop}-${id.slice(-8).toUpperCase()}`;
  p.b.add('INSERT INTO grain_lots (id,crop,lot_no,grade,opened_at,status,notes) VALUES (?,?,?,?,?,\'OPEN\',\'\')',
    id, crop, auto, grade, date);
  return id;
}

export async function postGrainPurchase(c: AppContext, input: GrainPurchaseInput) {
  const actor = requirePermission(c, 'grains.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const { perKg, maundKg } = await ratePerKg(c, input.rate_basis, input.rate_paisa);
  const w = netWeight({
    grossGrams: input.gross_grams, bags: input.bags,
    tarePerBagGrams: input.tare_per_bag_grams, deductions: input.deductions,
  });
  const goods = lineAmount(w.netGrams, perKg);
  const extras = input.commission_paisa + input.labour_paisa + input.transport_paisa;
  const total = goods + extras;
  const payments = await resolvePayments(db, input.payments, total);
  const paid = payments.reduce((a, b) => a + b.amount_paisa, 0);
  const due = total - paid;
  const business = await businessInfo(db);
  const cropUr = BOOK_MAP[input.crop]?.ur ?? input.crop;

  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(`${input.crop}_PURCHASE`);
    const id = ulid();
    const productId = await ensureGrainProduct({ db, posting: p, crop: input.crop, crop_ur: cropUr });
    await p.stockState(productId);
    const lotId = await ensureLot(c, p, input.crop, input.lot_no, input.grade, input.date);
    const party = await resolveParty({ db, posting: p, party_id: input.party_id, name: input.party_name,
      phone: input.party_phone, address: input.village, type: 'FARMER' });
    for (const payment of payments) await p.accountState(payment.account.id);

    const weighId = ulid();
    p.b.add(`INSERT INTO purchases (id,number,book_code,module_code,date,party_id,supplier_invoice_no,season,
      subtotal_paisa,discount_paisa,freight_paisa,loading_paisa,other_paisa,total_paisa,paid_paisa,due_paisa,
      status,note,snapshot_json,idempotency_key,provisional,created_at,created_by,updated_at,version)
      VALUES (?,?,?,?,?,?,'','NONE',?,0,?,?,?,?,?,?,'POSTED',?,'{}',?,0,?,?,?,1)`,
      id, number, input.crop, input.crop, input.date, party.id,
      goods, input.transport_paisa, input.labour_paisa, input.commission_paisa,
      total, paid, due, input.note, input.idempotency_key ?? null, p.at, actor.id, p.at);
    p.b.add(`INSERT INTO purchase_items (id,purchase_id,product_id,qty_milli,rate_paisa,discount_paisa,landed_cost_paisa,line_total_paisa,unit_cost_paisa,bags,created_at)
      VALUES (?,?,?,?,?,0,?,?,?,?,?)`,
      ulid(), id, productId, w.netGrams, perKg, extras, goods,
      Math.floor(total * 1000 / w.netGrams), input.bags, p.at);
    p.stockIn({ product_id: productId, batch_id: null, qty_milli: w.netGrams,
      cost_total_paisa: total, unit_cost_paisa: Math.floor(total * 1000 / w.netGrams),
      ref_type: 'GRAIN_PURCHASE', ref_id: id, book_code: input.crop, note: w.arithmetic.join(' | ') });
    p.b.add(`INSERT INTO grain_weighments (id,lot_id,crop,direction,date,doc_type,doc_id,gross_grams,bags,tare_per_bag_grams,tare_grams,deduction_grams,net_grams,rate_paisa,amount_paisa,arithmetic,created_at)
      VALUES (?,?,?,'IN',?,'GRAIN_PURCHASE',?,?,?,?,?,?,?,?,?,?,?)`,
      weighId, lotId, input.crop, input.date, id, w.grossGrams, input.bags,
      input.tare_per_bag_grams, w.tareGrams, w.deductionGrams, w.netGrams, perKg, goods,
      w.arithmetic.join(' | '), p.at);
    for (const d of w.deductionLines) {
      p.b.add('INSERT INTO grain_deductions (id,weighment_id,type,basis,value,weight_grams,note) VALUES (?,?,?,?,?,?,?)',
        ulid(), weighId, d.type, 'weight_grams', d.grams, d.grams, d.note ?? '');
    }
    for (const payment of payments) {
      p.accountTxn({ account_id: payment.account.id, direction: 'OUT', amount_paisa: payment.amount_paisa,
        ref_type: 'GRAIN_PURCHASE', ref_id: id, description_ur: `اجناس خرید ${number}` });
    }
    p.partyLedger({ party_id: party.id, book_code: input.crop, credit_paisa: total,
      ref_type: 'GRAIN_PURCHASE', ref_id: id, description_ur: `اجناس خرید ${number}` });
    if (paid) p.partyLedger({ party_id: party.id, book_code: input.crop, debit_paisa: paid,
      ref_type: 'GRAIN_PURCHASE_PAYMENT', ref_id: id, description_ur: `اجناس خرید ادائیگی ${number}` });
    p.journal({ ref_type: 'GRAIN_PURCHASE', ref_id: id, memo_ur: `${cropUr} خرید ${number} — ${party.name}`,
      lines: purchaseLines({ book: input.crop as any, total, payments: journalPayments(payments), credit: due, party_id: party.id }) });
    p.summary(input.crop, 'PURCHASE', total, w.netGrams);
    p.summary(input.crop, 'PAYABLE', due);
    p.summary('GENERAL', 'CASH_OUT', paid);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party, title_ur: 'وزن پرچی / خرید رسید',
      total_paisa: total, paid_paisa: paid, due_paisa: due,
      payment_method: paymentMethod(payments), note: input.note, book_code: input.crop,
    });
    snapshot.lines = [{ label: `${cropUr} (خالص وزن)`, qty: maundKg ? formatMaund(w.netGrams, maundKg) : fromMilli(w.netGrams),
      rate: formatPKR(perKg), amount_paisa: goods }];
    snapshot.subtotal_paisa = goods;
    snapshot.extras = [
      { label: 'کمیشن / Commission', amount_paisa: input.commission_paisa },
      { label: 'مزدوری / Labour', amount_paisa: input.labour_paisa },
      { label: 'ٹرانسپورٹ / Transport', amount_paisa: input.transport_paisa },
    ].filter((x) => x.amount_paisa);
    snapshot.arithmetic = w.arithmetic;
    p.document({ type: 'GRAIN_PURCHASE', number, party_id: party.id, amount_paisa: total,
      book_code: input.crop, ref_id: id, snapshot });
    if (input.idempotency_key) p.syncOperation({ key: input.idempotency_key,
      device_id: actor.device_id ?? 'server', type: 'GRAIN_PURCHASE', payload: input,
      local_time: p.at, doc_id: id, number });
    await p.commit();
    await audit(db, 'POST', 'grain_purchase', id, { user_id: actor.id, after: { number, net: w.netGrams, total } });
    return { id, number, net_grams: w.netGrams, arithmetic: w.arithmetic, total_paisa: total,
      due_paisa: due, lot_id: lotId, party_id: party.id, warnings: [] as string[] };
  });
}

export async function postGrainSale(c: AppContext, input: GrainSaleInput) {
  const actor = requirePermission(c, 'grains.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const { perKg, maundKg } = await ratePerKg(c, input.rate_basis, input.rate_paisa);
  const lot = await db.prepare('SELECT id,crop,lot_no,grade,status FROM grain_lots WHERE id=?').bind(input.lot_id).first<any>();
  if (!lot) throw new BizError(404, 'LOT_NOT_FOUND', 'لاٹ نہیں ملا', 'Lot not found');
  if (lot.crop !== input.crop) throw new BizError(400, 'CROP_MISMATCH', 'لاٹ اس فصل کا نہیں ہے', 'Lot belongs to a different crop');
  const balance = await lotBalance(db, input.lot_id);
  if (input.net_grams > balance) {
    throw new BizError(409, 'INSUFFICIENT_LOT_STOCK', `لاٹ بیلنس ${balance} گرام ہے، فروخت زیادہ ہے`, 'Cannot sell more than the lot balance');
  }
  const goods = lineAmount(input.net_grams, perKg);
  const total = goods - input.deductions_paisa - input.expenses_paisa;
  if (total < 0) throw new BizError(400, 'NEGATIVE_TOTAL', 'کل رقم منفی ہے', 'Total cannot be negative');
  const payments = await resolvePayments(db, input.payments, total);
  const paid = payments.reduce((a, b) => a + b.amount_paisa, 0);
  const due = total - paid;
  const business = await businessInfo(db);
  const cropUr = BOOK_MAP[input.crop]?.ur ?? input.crop;

  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(`${input.crop}_SALE`);
    const id = ulid();
    const productId = await ensureGrainProduct({ db, posting: p, crop: input.crop, crop_ur: cropUr });
    const state = await p.stockState(productId);
    // Same classification as stockOut(): cogsAtWeightedAverage() throws a bare Error, which the
    // offline sync route cannot tell apart from a bug. Raise the typed conflict first.
    if (input.net_grams > state.qty_milli) {
      throw new BizError(409, 'INSUFFICIENT_STOCK', `${cropUr}: اسٹاک ناکافی ہے`, `Insufficient stock for ${cropUr}`);
    }
    const cogs = state.qty_milli > 0 ? cogsAtWeightedAverage(state.value_paisa, state.qty_milli, input.net_grams) : 0;
    const party = await resolveParty({ db, posting: p, party_id: input.party_id, name: input.party_name,
      phone: input.party_phone, address: input.village, type: 'CUSTOMER' });
    for (const payment of payments) await p.accountState(payment.account.id);

    p.b.add(`INSERT INTO sales (id,number,book_code,module_code,date,party_id,buyer_name,buyer_mobile,buyer_address,season,
      subtotal_paisa,discount_paisa,total_paisa,cost_paisa,paid_paisa,due_paisa,status,note,snapshot_json,idempotency_key,provisional,created_at,created_by,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,'NONE',?,?,?,?,?,?,'POSTED',?,'{}',?,0,?,?,?,1)`,
      id, number, input.crop, input.crop, input.date, party.id, party.name,
      input.party_phone ?? '', input.village ?? '', goods,
      input.deductions_paisa + input.expenses_paisa, total, cogs, paid, due,
      input.note, input.idempotency_key ?? null, p.at, actor.id, p.at);
    p.b.add(`INSERT INTO sale_items (id,sale_id,product_id,qty_milli,rate_paisa,discount_paisa,line_total_paisa,cost_paisa,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, ulid(), id, productId, input.net_grams, perKg,
      input.deductions_paisa + input.expenses_paisa, total, cogs, p.at);
    p.stockOut({ product_id: productId, batch_id: null, qty_milli: input.net_grams,
      cost_total_paisa: cogs, unit_cost_paisa: input.net_grams ? Math.floor(cogs * 1000 / input.net_grams) : 0,
      ref_type: 'GRAIN_SALE', ref_id: id, book_code: input.crop });
    p.b.add(`INSERT INTO grain_weighments (id,lot_id,crop,direction,date,doc_type,doc_id,gross_grams,net_grams,rate_paisa,amount_paisa,arithmetic,created_at)
      VALUES (?,?,?,'OUT',?,'GRAIN_SALE',?,?,?,?,?,?,?)`,
      ulid(), input.lot_id, input.crop, input.date, id, input.net_grams, input.net_grams,
      perKg, total, `net=${input.net_grams}g`, p.at);
    for (const payment of payments) {
      p.accountTxn({ account_id: payment.account.id, direction: 'IN', amount_paisa: payment.amount_paisa,
        ref_type: 'GRAIN_SALE', ref_id: id, description_ur: `اجناس فروخت ${number}` });
    }
    p.partyLedger({ party_id: party.id, book_code: input.crop, debit_paisa: total,
      ref_type: 'GRAIN_SALE', ref_id: id, description_ur: `اجناس فروخت ${number}` });
    if (paid) p.partyLedger({ party_id: party.id, book_code: input.crop, credit_paisa: paid,
      ref_type: 'GRAIN_SALE_RECEIPT', ref_id: id, description_ur: `اجناس فروخت وصولی ${number}` });
    p.journal({ ref_type: 'GRAIN_SALE', ref_id: id, memo_ur: `${cropUr} فروخت ${number} — ${party.name}`,
      lines: saleLines({ book: input.crop as any, total, cost: cogs,
        payments: journalPayments(payments), credit: due, party_id: party.id }) });
    p.summary(input.crop, 'SALE', total, input.net_grams);
    p.summary(input.crop, 'COGS', cogs);
    p.summary('GENERAL', 'CASH_IN', paid);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party, title_ur: `${cropUr} فروخت رسید`,
      total_paisa: total, paid_paisa: paid, due_paisa: due,
      payment_method: paymentMethod(payments), note: input.note, book_code: input.crop,
    });
    snapshot.lines = [{ label: `${cropUr} (لاٹ ${lot.lot_no})`,
      qty: maundKg ? formatMaund(input.net_grams, maundKg) : fromMilli(input.net_grams),
      rate: formatPKR(perKg), amount_paisa: goods }];
    snapshot.subtotal_paisa = goods;
    snapshot.extras = [
      { label: 'کٹوتیاں / Deductions', amount_paisa: -input.deductions_paisa },
      { label: 'اخراجات / Expenses', amount_paisa: -input.expenses_paisa },
    ].filter((x) => x.amount_paisa);
    p.document({ type: 'GRAIN_SALE', number, party_id: party.id, amount_paisa: total,
      book_code: input.crop, ref_id: id, snapshot });
    if (input.idempotency_key) p.syncOperation({ key: input.idempotency_key,
      device_id: actor.device_id ?? 'server', type: 'GRAIN_SALE', payload: input,
      local_time: p.at, doc_id: id, number });
    await p.commit();
    await audit(db, 'POST', 'grain_sale', id, { user_id: actor.id, after: { number, total, cogs } });
    const privileged = actor.permissions.includes('*') || actor.roles.includes('OWNER') || actor.roles.includes('MANAGER');
    return { id, number, total_paisa: total, due_paisa: due, cost_paisa: cogs,
      margin_paisa: privileged ? total - cogs : undefined, party_id: party.id, warnings: [] as string[] };
  });
}
