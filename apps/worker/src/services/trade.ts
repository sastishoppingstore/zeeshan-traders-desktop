/** Fertilizer / pesticide / goods purchase, sale and returns postings. */
import {
  lineAmount, allocateProportional, sumPaisa, cogsAtWeightedAverage, fromMilli,
  ulid, purchaseLines, saleLines, saleReturnLines, purchaseReturnLines,
  BOOK_MAP, type PurchaseInput, type SaleInput, type DocumentSnapshot,
} from '@zt/shared';
import type { AppContext } from '../context.js';
import { BizError, assertPeriodOpen, businessInfo, encryptCnic, idempotentResult, purgePublicCache, audit } from '../context.js';
import { Posting, withPostingRetry, resolveParty, ensureBatch, snapshotBase } from '../posting.js';
import { checkProductBelongsToBook, resolvePayments, journalPayments, paymentMethod, maybeWarnCredit, setting, requirePermission } from './common.js';
import { formatPKR } from '@zt/shared';

interface DocLineResult {
  product: any; product_id: string; batch_id: string | null; qty_milli: number; rate_paisa: number;
  line_total_paisa: number; cost_total_paisa: number; unit_cost_paisa: number; discount_paisa: number;
  batch_no?: string; mfg_date?: string; expiry_date?: string; manufacturer?: string;
  bags?: number; weight_per_bag_grams?: number;
}

async function preparePurchaseLines(c: AppContext, input: PurchaseInput): Promise<{ lines: DocLineResult[]; subtotal: number; total: number; extras: number }> {
  const db = c.get('db')!;
  const lines: DocLineResult[] = [];
  for (const l of input.lines) {
    const product = await checkProductBelongsToBook(db, l.product_id, input.book_code);
    if (input.book_code === 'PEST' || product.is_pesticide) {
      if (!l.batch_no || !l.mfg_date || !l.expiry_date || !l.manufacturer) {
        throw new BizError(400, 'PESTICIDE_FIELDS_REQUIRED', 'پیسٹی سائیڈ کے لیے بیچ، تاریخِ تیاری، ایکسپائری اور مینوفیکچرر لازمی ہیں', 'Batch, MFG, expiry and manufacturer are mandatory for pesticides');
      }
      if (l.expiry_date <= l.mfg_date) throw new BizError(400, 'EXPIRY_BEFORE_MFG', 'ایکسپائری تاریخ غلط ہے', 'Expiry must be after manufacturing date');
    }
    const gross = lineAmount(l.qty_milli, l.rate_paisa);
    const lineTotal = gross - l.discount_paisa;
    if (lineTotal < 0) throw new BizError(400, 'NEGATIVE_LINE', 'لائن کی رقم منفی ہے', 'Line total cannot be negative');
    lines.push({
      product, product_id: l.product_id, batch_id: null, qty_milli: l.qty_milli,
      rate_paisa: l.rate_paisa, line_total_paisa: lineTotal, cost_total_paisa: lineTotal,
      unit_cost_paisa: Math.floor((lineTotal * 1000) / l.qty_milli), discount_paisa: l.discount_paisa,
      batch_no: l.batch_no, mfg_date: l.mfg_date, expiry_date: l.expiry_date,
      manufacturer: l.manufacturer, bags: l.bags, weight_per_bag_grams: l.weight_per_bag_grams,
    });
  }
  const subtotal = sumPaisa(lines.map((l) => l.line_total_paisa));
  const extras = input.freight_paisa + input.loading_paisa + input.other_paisa - input.discount_paisa;
  const basis = (await setting<'weight' | 'value'>(c, 'landed_cost_basis')) ?? 'value';
  const weights = lines.map((l) => (basis === 'weight' ? l.qty_milli : l.line_total_paisa));
  const parts = allocateProportional(extras, weights, basis);
  lines.forEach((l, i) => {
    l.cost_total_paisa = l.line_total_paisa + parts[i];
    l.unit_cost_paisa = Math.floor((l.cost_total_paisa * 1000) / l.qty_milli);
  });
  const total = subtotal + extras;
  if (total < 0) throw new BizError(400, 'NEGATIVE_TOTAL', 'کل رقم منفی ہے', 'Total cannot be negative');
  return { lines, subtotal, total, extras };
}

export async function postPurchase(c: AppContext, input: PurchaseInput) {
  const actor = requirePermission(c, 'purchases.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const { lines, subtotal, total } = await preparePurchaseLines(c, input);
  const payments = await resolvePayments(db, input.payments, total);
  const paid = sumPaisa(payments.map((p) => p.amount_paisa));
  const due = total - paid;
  const business = await businessInfo(db);

  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(`${input.book_code}_PURCHASE`);
    const id = ulid();
    const party = await resolveParty({
      db, posting: p, party_id: input.party_id, name: input.party_name,
      phone: input.party_phone, address: input.party_address, type: 'SUPPLIER',
    });
    for (const payment of payments) await p.accountState(payment.account.id);
    for (const l of lines) {
      await p.stockState(l.product_id);
      l.batch_id = await ensureBatch({
        db, posting: p, product_id: l.product_id, batch_no: l.batch_no,
        mfg_date: l.mfg_date, expiry_date: l.expiry_date, manufacturer: l.manufacturer,
      });
      if (l.batch_id) await p.batchState(l.batch_id);
    }

    p.b.add(`INSERT INTO purchases (id,number,book_code,module_code,date,party_id,supplier_invoice_no,season,
      subtotal_paisa,discount_paisa,freight_paisa,loading_paisa,other_paisa,total_paisa,paid_paisa,due_paisa,
      status,note,snapshot_json,idempotency_key,provisional,created_at,created_by,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'POSTED',?,'{}',?,0,?,?,?,1)`,
      id, number, input.book_code, input.book_code, input.date, party.id, input.supplier_invoice_no ?? '',
      input.season, subtotal, input.discount_paisa, input.freight_paisa, input.loading_paisa,
      input.other_paisa, total, paid, due, input.note, input.idempotency_key ?? null, p.at, actor.id, p.at);

    const snapLines: DocumentSnapshot['lines'] = [];
    for (const l of lines) {
      const itemId = ulid();
      p.b.add(`INSERT INTO purchase_items (id,purchase_id,product_id,batch_id,qty_milli,rate_paisa,discount_paisa,landed_cost_paisa,line_total_paisa,unit_cost_paisa,bags,weight_per_bag_grams,manufacturer,mfg_date,expiry_date,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        itemId, id, l.product_id, l.batch_id, l.qty_milli, l.rate_paisa, l.discount_paisa,
        l.cost_total_paisa - l.line_total_paisa, l.line_total_paisa, l.unit_cost_paisa,
        l.bags ?? 0, l.weight_per_bag_grams ?? 0, l.manufacturer ?? '',
        l.mfg_date ?? null, l.expiry_date ?? null, p.at);
      p.stockIn({
        product_id: l.product_id, batch_id: l.batch_id, qty_milli: l.qty_milli,
        cost_total_paisa: l.cost_total_paisa, unit_cost_paisa: l.unit_cost_paisa,
        ref_type: 'PURCHASE', ref_id: id, book_code: input.book_code,
      });
      snapLines.push({
        label: l.product.name_ur, qty: fromMilli(l.qty_milli), rate: formatPKR(l.rate_paisa),
        amount_paisa: l.line_total_paisa, batch: l.batch_no,
      });
    }
    for (const payment of payments) {
      p.accountTxn({ account_id: payment.account.id, direction: 'OUT', amount_paisa: payment.amount_paisa,
        ref_type: 'PURCHASE', ref_id: id, description_ur: `خرید ${number}` });
    }
    p.partyLedger({ party_id: party.id, book_code: input.book_code, credit_paisa: total,
      ref_type: 'PURCHASE', ref_id: id, description_ur: `خرید ${number}` });
    if (paid > 0) p.partyLedger({ party_id: party.id, book_code: input.book_code, debit_paisa: paid,
      ref_type: 'PURCHASE_PAYMENT', ref_id: id, description_ur: `خرید کی ادائیگی ${number}` });
    p.journal({
      ref_type: 'PURCHASE', ref_id: id, memo_ur: `خرید ${number} — ${party.name}`,
      lines: purchaseLines({ book: input.book_code as any, total, payments: journalPayments(payments), credit: due, party_id: party.id }),
    });
    p.summary(input.book_code, 'PURCHASE', total, sumPaisa(lines.map((l) => l.qty_milli)));
    p.summary(input.book_code, 'PAYABLE', due);
    p.summary('GENERAL', 'CASH_OUT', paid);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party, title_ur: 'خرید رسید / Purchase invoice',
      total_paisa: total, paid_paisa: paid, due_paisa: due,
      payment_method: paymentMethod(payments), note: input.note, book_code: input.book_code,
    });
    snapshot.lines = snapLines;
    snapshot.subtotal_paisa = subtotal;
    snapshot.extras = [
      { label: 'رعایت / Discount', amount_paisa: -input.discount_paisa },
      { label: 'مال برداری / Freight', amount_paisa: input.freight_paisa },
      { label: 'لوڈنگ / Loading', amount_paisa: input.loading_paisa },
      { label: 'دیگر / Other', amount_paisa: input.other_paisa },
    ].filter((x) => x.amount_paisa !== 0);
    p.document({ type: 'PURCHASE', number, party_id: party.id, amount_paisa: total,
      book_code: input.book_code, ref_id: id, snapshot });
    if (input.idempotency_key) p.syncOperation({
      key: input.idempotency_key, device_id: actor.device_id ?? 'server', type: 'PURCHASE',
      payload: input, local_time: p.at, doc_id: id, number,
    });
    await p.commit();
    await audit(db, 'POST', 'purchases', id, { user_id: actor.id, after: { number, total, due } });
    return { id, number, total_paisa: total, due_paisa: due, party_id: party.id, warnings: [] as string[] };
  });
}

async function prepareSaleLines(c: AppContext, input: SaleInput) {
  const db = c.get('db')!;
  const negativeAllowed = (await setting<boolean>(c, 'negative_stock_allowed')) ?? false;
  const lines: DocLineResult[] = [];
  for (const l of input.lines) {
    const product = await checkProductBelongsToBook(db, l.product_id, input.book_code);
    let batchId: string | null = l.batch_id ?? null;
    if (batchId) {
      const b = await db.prepare('SELECT id,expiry_date,quarantined FROM product_batches WHERE id=?').bind(batchId).first<any>();
      if (!b) throw new BizError(400, 'BATCH_NOT_FOUND', 'بیچ نہیں ملا', 'Batch not found');
      if (b.quarantined) throw new BizError(409, 'BATCH_QUARANTINED', 'یہ بیچ کوارنٹین میں ہے', 'Batch is quarantined');
      if (b.expiry_date && b.expiry_date < input.date) {
        throw new BizError(409, 'EXPIRED_BATCH', 'ایکسپائرڈ بیچ فروخت نہیں ہو سکتا', 'Expired batch cannot be sold (hard block)');
      }
    } else if (product.track_expiry || product.track_batch) {
      // FEFO suggestion: earliest non-expired, non-quarantined batch with stock.
      const b = await db.prepare(`SELECT pb.id,pb.expiry_date,COALESCE(sbb.qty_milli,0) AS qty
        FROM product_batches pb LEFT JOIN stock_batch_balance sbb ON sbb.batch_id=pb.id
        WHERE pb.product_id=? AND pb.quarantined=0 AND (pb.expiry_date IS NULL OR pb.expiry_date>=?)
          AND COALESCE(sbb.qty_milli,0) >= ?
        ORDER BY (pb.expiry_date IS NULL), pb.expiry_date ASC LIMIT 1`)
        .bind(l.product_id, input.date, l.qty_milli).first<any>();
      if (b) batchId = b.id;
      else {
        const expired = await db.prepare('SELECT COUNT(*) c FROM product_batches WHERE product_id=? AND expiry_date < ?')
          .bind(l.product_id, input.date).first<{ c: number }>();
        if (expired && expired.c > 0) throw new BizError(409, 'EXPIRED_BATCH', 'اس مصنوعات کا قابلِ فروخت بیچ نہیں ہے (ایکسپائری ختم)', 'No sellable batch: all batches expired');
      }
    }
    const gross = lineAmount(l.qty_milli, l.rate_paisa);
    const lineTotal = gross - l.discount_paisa;
    if (lineTotal < 0) throw new BizError(400, 'NEGATIVE_LINE', 'لائن کی رقم منفی ہے', 'Line total cannot be negative');
    const stock = await db.prepare('SELECT qty_milli,value_paisa FROM stock_balance WHERE product_id=? AND warehouse_id=?')
      .bind(l.product_id, 'wh-main').first<{ qty_milli: number; value_paisa: number }>();
    if (!negativeAllowed && (stock?.qty_milli ?? 0) < l.qty_milli) {
      throw new BizError(409, 'INSUFFICIENT_STOCK', `${product.name_ur}: اسٹاک ناکافی ہے`, `Insufficient stock for ${product.name_ur}`);
    }
    lines.push({
      product, product_id: l.product_id, batch_id: batchId, qty_milli: l.qty_milli,
      rate_paisa: l.rate_paisa, line_total_paisa: lineTotal, cost_total_paisa: 0,
      unit_cost_paisa: 0, discount_paisa: l.discount_paisa,
    });
  }
  const subtotal = sumPaisa(lines.map((l) => l.line_total_paisa));
  const total = subtotal - input.discount_paisa;
  if (total < 0) throw new BizError(400, 'NEGATIVE_TOTAL', 'کل رقم منفی ہے', 'Total cannot be negative');
  return { lines, subtotal, total, negativeAllowed };
}

export async function postSale(c: AppContext, input: SaleInput) {
  const actor = requirePermission(c, 'sales.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const existing = await idempotentResult(db, input.idempotency_key);
  if (existing) return { ...existing, duplicate: true };
  const isPest = input.book_code === 'PEST';
  if (isPest && (!input.party_phone || !input.party_address)) {
    throw new BizError(400, 'PESTICIDE_BUYER_REQUIRED', 'پیسٹی سائیڈ کی فروخت میں خریدار کا نام، موبائل اور پتہ لازمی ہے', 'Pesticide sale requires buyer name, mobile and address');
  }
  const requireFertCnic = (await setting<boolean>(c, 'require_cnic_on_fertilizer_sale')) ?? false;
  if (input.book_code === 'FERT' && requireFertCnic && !input.cnic) {
    throw new BizError(400, 'CNIC_REQUIRED', 'کھاد کی فروخت کے لیے شناختی کارڈ نمبر لازمی ہے', 'CNIC required by settings');
  }
  const { lines, subtotal, total } = await prepareSaleLines(c, input);
  const payments = await resolvePayments(db, input.payments, total);
  const paid = sumPaisa(payments.map((p) => p.amount_paisa));
  const due = total - paid;
  const warnings: string[] = [];
  const business = await businessInfo(db);
  const cnicEnc = await encryptCnic(c, input.cnic);

  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(`${input.book_code}_SALE`);
    const id = ulid();
    const party = await resolveParty({
      db, posting: p, party_id: input.party_id, name: input.party_name,
      phone: input.party_phone, address: input.party_address, type: 'CUSTOMER', cnic_enc: cnicEnc,
    });
    await maybeWarnCredit(db, party.id, due, warnings);
    for (const payment of payments) await p.accountState(payment.account.id);
    for (const l of lines) {
      await p.stockState(l.product_id);
      if (l.batch_id) await p.batchState(l.batch_id);
    }
    // Pre-pass: freeze COGS for every line using a simulated weighted-average state,
    // so the header (which sale_items FK-references) can be inserted FIRST in the batch.
    let totalCost = 0;
    const sim = new Map<string, { qty_milli: number; value_paisa: number }>();
    for (const [k, st] of p.stock) sim.set(k, { qty_milli: st.qty_milli, value_paisa: st.value_paisa });
    for (const l of lines) {
      const st = sim.get(`${l.product_id}|${p.warehouse_id}`)!;
      const cost = st.qty_milli > 0 ? cogsAtWeightedAverage(st.value_paisa, st.qty_milli, l.qty_milli) : 0;
      l.cost_total_paisa = cost;
      l.unit_cost_paisa = l.qty_milli > 0 ? Math.floor(cost * 1000 / l.qty_milli) : 0;
      totalCost += cost;
      st.qty_milli -= l.qty_milli;
      st.value_paisa -= cost;
    }
    p.b.add(`INSERT INTO sales (id,number,book_code,module_code,date,party_id,buyer_name,buyer_mobile,buyer_address,cnic_enc,season,
      subtotal_paisa,discount_paisa,total_paisa,cost_paisa,paid_paisa,due_paisa,status,note,snapshot_json,idempotency_key,provisional,created_at,created_by,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'POSTED',?,'{}',?,0,?,?,?,1)`,
      id, number, input.book_code, input.book_code, input.date, party.id, party.name,
      input.party_phone ?? party.phone, input.party_address ?? party.address, cnicEnc, input.season,
      subtotal, input.discount_paisa, total, totalCost, paid, due, input.note,
      input.idempotency_key ?? null, p.at, actor.id, p.at);
    const snapLines: DocumentSnapshot['lines'] = [];
    for (const l of lines) {
      const cost = l.cost_total_paisa;
      const itemId = ulid();
      p.b.add(`INSERT INTO sale_items (id,sale_id,product_id,batch_id,qty_milli,rate_paisa,discount_paisa,line_total_paisa,cost_paisa,returned_milli,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
        itemId, id, l.product_id, l.batch_id, l.qty_milli, l.rate_paisa, l.discount_paisa,
        l.line_total_paisa, cost, p.at);
      p.stockOut({
        product_id: l.product_id, batch_id: l.batch_id, qty_milli: l.qty_milli,
        cost_total_paisa: cost, unit_cost_paisa: l.unit_cost_paisa,
        ref_type: 'SALE', ref_id: id, book_code: input.book_code,
      });
      snapLines.push({ label: l.product.name_ur, qty: fromMilli(l.qty_milli),
        rate: formatPKR(l.rate_paisa), amount_paisa: l.line_total_paisa });
    }
    for (const payment of payments) {
      p.accountTxn({ account_id: payment.account.id, direction: 'IN', amount_paisa: payment.amount_paisa,
        ref_type: 'SALE', ref_id: id, description_ur: `فروخت ${number}` });
    }
    p.partyLedger({ party_id: party.id, book_code: input.book_code, debit_paisa: total,
      ref_type: 'SALE', ref_id: id, description_ur: `فروخت ${number}` });
    if (paid > 0) p.partyLedger({ party_id: party.id, book_code: input.book_code, credit_paisa: paid,
      ref_type: 'SALE_RECEIPT', ref_id: id, description_ur: `فروخت پر وصولی ${number}` });
    p.journal({
      ref_type: 'SALE', ref_id: id, memo_ur: `فروخت ${number} — ${party.name}`,
      lines: saleLines({ book: input.book_code as any, total, cost: totalCost,
        payments: journalPayments(payments), credit: due, party_id: party.id }),
    });
    p.summary(input.book_code, 'SALE', total, sumPaisa(lines.map((l) => l.qty_milli)));
    p.summary(input.book_code, 'COGS', totalCost);
    p.summary(input.book_code, 'RECEIVABLE', due);
    p.summary('GENERAL', 'CASH_IN', paid);
    const snapshot = snapshotBase(business, {
      number, date: input.date, party: { name: party.name, phone: input.party_phone ?? party.phone, address: input.party_address ?? party.address },
      title_ur: isPest ? 'پیسٹی سائیڈ فروخت رسید' : 'فروخت رسید / Sale invoice',
      total_paisa: total, paid_paisa: paid, due_paisa: due,
      payment_method: paymentMethod(payments), note: input.note, book_code: input.book_code,
    });
    snapshot.lines = snapLines;
    snapshot.subtotal_paisa = subtotal;
    snapshot.extras = input.discount_paisa ? [{ label: 'رعایت / Discount', amount_paisa: -input.discount_paisa }] : [];
    p.document({ type: 'SALE', number, party_id: party.id, amount_paisa: total,
      book_code: input.book_code, ref_id: id, snapshot });
    if (input.idempotency_key) p.syncOperation({
      key: input.idempotency_key, device_id: actor.device_id ?? 'server', type: 'SALE',
      payload: input, local_time: p.at, doc_id: id, number,
    });
    await p.commit();
    await audit(db, 'POST', 'sales', id, { user_id: actor.id, after: { number, total, due, cost: totalCost } });
    return { id, number, total_paisa: total, due_paisa: due, cost_paisa: totalCost, party_id: party.id, warnings };
  });
}
