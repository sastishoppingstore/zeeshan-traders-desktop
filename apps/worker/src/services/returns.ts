/** Sale / purchase returns, linked to the original invoice, at ORIGINAL cost (H2: never edits posted rows). */
import { ulid, saleReturnLines, purchaseReturnLines, fromMilli, type DocumentSnapshot } from '@zt/shared';
import type { AppContext } from '../context.js';
import { BizError, assertPeriodOpen, businessInfo, audit } from '../context.js';
import { Posting, withPostingRetry, snapshotBase } from '../posting.js';
import { resolveAccount, requirePermission } from './common.js';

export interface ReturnInput {
  type: 'SALE' | 'PURCHASE'; original_id: string; date: string; reason: string;
  refund_method: 'ACCOUNT' | 'KHATA'; account_id?: string;
  lines: { line_id: string; qty_milli: number }[];
}

export async function postReturn(c: AppContext, input: ReturnInput) {
  const actor = requirePermission(c, 'returns.post');
  const db = c.get('db')!;
  await assertPeriodOpen(db, input.date);
  const isSale = input.type === 'SALE';
  const table = isSale ? 'sales' : 'purchases';
  const itemTable = isSale ? 'sale_items' : 'purchase_items';
  const fk = isSale ? 'sale_id' : 'purchase_id';
  const header = await db.prepare(`SELECT id,number,party_id,book_code,total_paisa,status FROM ${table} WHERE id=?`)
    .bind(input.original_id).first<any>();
  if (!header) throw new BizError(404, 'NOT_FOUND', 'اصل دستاویز نہیں ملی', 'Original document not found');
  if (header.status !== 'POSTED') throw new BizError(409, 'NOT_POSTED', 'صرف پوسٹڈ دستاویز واپس ہو سکتی ہے', 'Only posted documents can be returned');

  let refund = 0, cost = 0;
  const prepared: { line: any; qty_milli: number; amount: number; cost: number }[] = [];
  for (const r of input.lines) {
    const line = await db.prepare(`SELECT * FROM ${itemTable} WHERE id=? AND ${fk}=?`).bind(r.line_id, input.original_id).first<any>();
    if (!line) throw new BizError(400, 'LINE_NOT_FOUND', 'لائن نہیں ملی', 'Return line not found');
    const returnable = line.qty_milli - (line.returned_milli ?? 0);
    if (r.qty_milli > returnable) throw new BizError(400, 'RETURN_EXCEEDS_ORIGINAL', 'واپسی مقدار اصل سے زیادہ ہے', 'Return quantity exceeds original');
    const ratio = Number((BigInt(r.qty_milli) * 1_000_000n) / BigInt(line.qty_milli)) / 1_000_000;
    const amount = Math.round(line.line_total_paisa * ratio);
    // Purchase lines carry no COGS; their line total IS the inventory value, so the
    // reversal uses the same amount. Sale lines restore stock at the frozen COGS.
    const lineCost = isSale ? Math.round((line.cost_paisa ?? 0) * ratio) : amount;
    refund += amount;
    cost += lineCost;
    prepared.push({ line, qty_milli: r.qty_milli, amount, cost: lineCost });
  }
  if (refund <= 0) throw new BizError(400, 'ZERO_RETURN', 'واپسی کی رقم صفر ہے', 'Return amount is zero');
  const account = input.refund_method === 'ACCOUNT'
    ? await resolveAccount(db, input.account_id ?? '')
    : null;
  if (input.refund_method === 'ACCOUNT' && !account) throw new BizError(400, 'ACCOUNT_REQUIRED', 'اکاؤنٹ درکار ہے', 'Account required for refund');
  const business = await businessInfo(db);
  const party = await db.prepare('SELECT name_ur,phone,village FROM parties WHERE id=?').bind(header.party_id).first<any>();

  return withPostingRetry(async () => {
    const p = new Posting(db, actor, input.date);
    const number = await p.reserveNumber(isSale ? 'SALE_RETURN' : 'PURCHASE_RETURN');
    const id = ulid();
    await p.partyState(header.party_id);
    if (account) await p.accountState(account.id);
    for (const x of prepared) {
      await p.stockState(x.line.product_id);
      if (x.line.batch_id) await p.batchState(x.line.batch_id);
    }

    // Journal first so the return header can reference it.
    const journalId = p.journal({
      ref_type: isSale ? 'SALE_RETURN' : 'PURCHASE_RETURN', ref_id: id,
      memo_ur: `${isSale ? 'فروخت' : 'خرید'} واپسی ${number}`,
      reason: input.reason,
      lines: isSale
        ? saleReturnLines({ refund, cost, account: account?.code ?? 'CASH',
            creditToKhata: input.refund_method === 'KHATA', party_id: header.party_id, book: header.book_code })
        : purchaseReturnLines({ amount: cost || refund, account: account?.code ?? 'CASH',
            creditToKhata: input.refund_method === 'KHATA', party_id: header.party_id, book: header.book_code }),
    });

    if (isSale) {
      p.b.add(`INSERT INTO sales_returns (id,number,sale_id,date,reason,total_paisa,cost_paisa,refund_method,journal_id,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, number, input.original_id, input.date, input.reason, refund, cost, input.refund_method, journalId, p.at, actor.id);
    } else {
      p.b.add(`INSERT INTO purchase_returns (id,number,purchase_id,date,reason,total_paisa,refund_method,journal_id,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, number, input.original_id, input.date, input.reason, refund, input.refund_method, journalId, p.at, actor.id);
    }
    const retItems = isSale ? 'sale_return_items' : 'purchase_return_items';
    for (const x of prepared) {
      if (isSale) {
        p.b.add('INSERT INTO sale_return_items (id,return_id,line_id,qty_milli,amount_paisa,cost_paisa) VALUES (?,?,?,?,?,?)',
          ulid(), id, x.line.id, x.qty_milli, x.amount, x.cost);
      } else {
        p.b.add('INSERT INTO purchase_return_items (id,return_id,line_id,qty_milli,amount_paisa) VALUES (?,?,?,?,?)',
          ulid(), id, x.line.id, x.qty_milli, x.amount);
      }
      p.b.add(`UPDATE ${itemTable} SET returned_milli=returned_milli+? WHERE id=? AND returned_milli=?`,
        x.qty_milli, x.line.id, x.line.returned_milli ?? 0);
      const unitCost = x.qty_milli > 0 ? Math.floor(x.cost * 1000 / x.qty_milli) : 0;
      if (isSale) {
        p.stockIn({ product_id: x.line.product_id, batch_id: x.line.batch_id ?? null,
          qty_milli: x.qty_milli, cost_total_paisa: x.cost, unit_cost_paisa: unitCost,
          ref_type: 'SALE_RETURN', ref_id: id, book_code: header.book_code, note: input.reason });
      } else {
        p.stockOut({ product_id: x.line.product_id, batch_id: x.line.batch_id ?? null,
          qty_milli: x.qty_milli, cost_total_paisa: x.cost, unit_cost_paisa: unitCost,
          ref_type: 'PURCHASE_RETURN', ref_id: id, book_code: header.book_code, note: input.reason });
      }
    }
    if (account) {
      p.accountTxn({ account_id: account.id, direction: isSale ? 'OUT' : 'IN', amount_paisa: refund,
        ref_type: isSale ? 'SALE_RETURN' : 'PURCHASE_RETURN', ref_id: id, description_ur: `واپسی ${number}` });
    }
    if (isSale) {
      p.partyLedger({ party_id: header.party_id, book_code: header.book_code, credit_paisa: refund,
        ref_type: 'SALE_RETURN', ref_id: id, description_ur: `فروخت واپسی ${number}` });
      p.summary(header.book_code, 'SALE_RETURN', refund);
    } else {
      p.partyLedger({ party_id: header.party_id, book_code: header.book_code, debit_paisa: refund,
        ref_type: 'PURCHASE_RETURN', ref_id: id, description_ur: `خرید واپسی ${number}` });
      p.summary(header.book_code, 'PURCHASE_RETURN', refund);
    }
    const snapshot = snapshotBase(business, {
      number, date: input.date,
      party: { name: party?.name_ur ?? '', phone: party?.phone, address: party?.village },
      title_ur: isSale ? 'فروخت واپسی رسید' : 'خرید واپسی رسید',
      total_paisa: refund, paid_paisa: 0, due_paisa: 0,
      payment_method: input.refund_method === 'KHATA' ? 'کھاتہ / Khata' : (account?.name_ur ?? ''),
      note: input.reason, book_code: header.book_code,
    });
    snapshot.lines = prepared.map((x) => ({ label: `واپسی ${x.line.product_id.slice(-6)}`,
      qty: fromMilli(x.qty_milli), rate: '', amount_paisa: x.amount }));
    p.document({ type: isSale ? 'SALE_RETURN' : 'PURCHASE_RETURN', number, party_id: header.party_id,
      amount_paisa: refund, book_code: header.book_code, ref_id: id, snapshot });
    await p.commit();
    await audit(db, 'RETURN', isSale ? 'sales_returns' : 'purchase_returns', id,
      { user_id: actor.id, reason: input.reason, after: { number, refund } });
    return { id, number, total_paisa: refund, cost_paisa: cost };
  });
}
