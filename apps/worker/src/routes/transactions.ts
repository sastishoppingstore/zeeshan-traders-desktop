/** Transaction endpoints. Every POST goes to a service that posts ONE atomic db.batch(). */
import type { Hono } from 'hono';
import type { AppEnv, AppVars, AppContext } from '../context.js';
import { ok, fail, handle, me, audit, nowIso, requirePerm, BizError } from '../context.js';
import {
  purchaseSchema, saleSchema, receiptSchema, paymentSchema, transferSchema, jazzSchema,
  expenseSchema, employeeSchema, advanceSchema, payrollSchema, returnSchema,
  grainPurchaseSchema, grainSaleSchema, stockAdjustmentSchema, stockOpeningSchema,
  stockCountSchema, manualJournalSchema, partySchema, periodCloseSchema, reconcileSchema,
  CROP_CODES, ulid,
} from '@zt/shared';
import { postPurchase, postSale } from '../services/trade.js';
import { postReturn } from '../services/returns.js';
import { postGrainPurchase, postGrainSale, lotBalance } from '../services/grains.js';
import { postReceipt, postTransfer, postJazz, postExpense, postAdvance, postPayroll, postReconciliation } from '../services/money.js';
import { postParty, postStockOpening, postStockAdjustment, postStockCount, postManualJournal } from '../services/inventory.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

function listSql(table: 'purchases' | 'sales', c: AppContext) {
  const db = c.get('db')!;
  const where = ['1=1']; const args: (string | number)[] = [];
  for (const key of ['book_code', 'party_id', 'status'] as const) {
    const v = c.req.query(key);
    if (v) { where.push(`${key}=?`); args.push(v); }
  }
  const from = c.req.query('from'), to = c.req.query('to');
  if (from) { where.push('date>=?'); args.push(from); }
  if (to) { where.push('date<=?'); args.push(to); }
  const cursor = c.req.query('cursor');
  if (cursor) { const [ts, id] = cursor.split('|'); where.push('(created_at<? OR (created_at=? AND id<?))'); args.push(ts, ts, id); }
  const limit = Math.min(Number(c.req.query('limit') ?? 25) || 25, 100);
  return { db, sql: `SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`, args: [...args, limit] };
}

export function registerTransactions(app: H) {
  // -------------------------------- purchases / sales ---------------------------
  app.post('/api/v1/purchases', requirePerm('purchases.post'), (c) => handle(c, async () => {
    const input = purchaseSchema.parse(await c.req.json());
    return ok(c, await postPurchase(c, input), 201);
  }));
  app.post('/api/v1/sales', requirePerm('sales.post'), (c) => handle(c, async () => {
    const input = saleSchema.parse(await c.req.json());
    return ok(c, await postSale(c, input), 201);
  }));
  app.get('/api/v1/purchases', requirePerm('purchases.read'), (c) => handle(c, async () => {
    const { db, sql, args } = listSql('purchases', c);
    const rows = await db.prepare(sql).bind(...args).all<any>();
    return ok(c, { rows, next_cursor: rows.length ? `${rows[rows.length - 1].created_at}|${rows[rows.length - 1].id}` : null });
  }));
  app.get('/api/v1/sales', requirePerm('sales.read'), (c) => handle(c, async () => {
    const { db, sql, args } = listSql('sales', c);
    const rows = await db.prepare(sql).bind(...args).all<any>();
    return ok(c, { rows, next_cursor: rows.length ? `${rows[rows.length - 1].created_at}|${rows[rows.length - 1].id}` : null });
  }));
  app.get('/api/v1/purchases/:id', requirePerm('purchases.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare('SELECT * FROM purchases WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'دستاویز نہیں ملی', 'Not found');
    const lines = await db.prepare('SELECT * FROM purchase_items WHERE purchase_id=?').bind(row.id).all();
    return ok(c, { ...row, lines });
  }));
  app.get('/api/v1/sales/:id', requirePerm('sales.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare('SELECT * FROM sales WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'دستاویز نہیں ملی', 'Not found');
    const lines = await db.prepare('SELECT * FROM sale_items WHERE sale_id=?').bind(row.id).all();
    const allocations = await db.prepare("SELECT * FROM payment_allocations WHERE invoice_type='SALE' AND invoice_id=?").bind(row.id).all();
    return ok(c, { ...row, lines, allocations });
  }));
  app.post('/api/v1/returns', requirePerm('returns.post'), (c) => handle(c, async () => {
    const input = returnSchema.parse(await c.req.json());
    return ok(c, await postReturn(c, input), 201);
  }));
  app.get('/api/v1/returns', requirePerm('returns.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const [sr, pr] = await Promise.all([
      db.prepare('SELECT * FROM sales_returns ORDER BY date DESC LIMIT 50').all(),
      db.prepare('SELECT * FROM purchase_returns ORDER BY date DESC LIMIT 50').all(),
    ]);
    return ok(c, { sales_returns: sr, purchase_returns: pr });
  }));

  // ---------------------------------- grains ----------------------------------
  app.post('/api/v1/grains/:crop/purchase', requirePerm('grains.post'), (c) => handle(c, async () => {
    const crop = c.req.param('crop').toUpperCase();
    if (!(CROP_CODES as readonly string[]).includes(crop)) throw new BizError(400, 'UNKNOWN_CROP', 'نامعلوم فصل', 'Unknown crop');
    const raw = await c.req.json();
    const input = grainPurchaseSchema.parse({ ...raw, crop });
    return ok(c, await postGrainPurchase(c, input), 201);
  }));
  app.post('/api/v1/grains/:crop/sale', requirePerm('grains.post'), (c) => handle(c, async () => {
    const crop = c.req.param('crop').toUpperCase();
    if (!(CROP_CODES as readonly string[]).includes(crop)) throw new BizError(400, 'UNKNOWN_CROP', 'نامعلوم فصل', 'Unknown crop');
    const raw = await c.req.json();
    const input = grainSaleSchema.parse({ ...raw, crop });
    return ok(c, await postGrainSale(c, input), 201);
  }));
  app.get('/api/v1/grains/lots', requirePerm('grains.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const crop = c.req.query('crop');
    const rows = crop
      ? await db.prepare('SELECT * FROM grain_lots WHERE crop=? ORDER BY opened_at DESC LIMIT 100').bind(crop.toUpperCase()).all<any>()
      : await db.prepare('SELECT * FROM grain_lots ORDER BY opened_at DESC LIMIT 100').all<any>();
    const withBalance = await Promise.all(rows.map(async (r) => ({ ...r, balance_grams: await lotBalance(db, r.id) })));
    return ok(c, withBalance);
  }));
  app.get('/api/v1/grains/summary', requirePerm('grains.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT book_code,metric,SUM(value_paisa) paisa,SUM(value_milli) milli
      FROM daily_summary WHERE book_code IN ('WHEAT','RICE','SESAME','MILLET','MAIZE','MOONG','MUSTARD')
      GROUP BY book_code,metric LIMIT 100`).all();
    return ok(c, rows);
  }));

  // ---------------------------------- parties ---------------------------------
  app.get('/api/v1/parties', requirePerm('parties.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const type = c.req.query('type');
    const q = (c.req.query('q') ?? '').trim();
    const where = ['p.is_active=1']; const args: (string | number)[] = [];
    if (type) { where.push('p.type=?'); args.push(type); }
    if (q) { where.push('(p.name_ur LIKE ? OR p.phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const rows = await db.prepare(`SELECT p.*,COALESCE(pb.balance_paisa,0) AS balance_paisa
      FROM parties p LEFT JOIN party_balance pb ON pb.party_id=p.id
      WHERE ${where.join(' AND ')} ORDER BY p.name_ur LIMIT ?`).bind(...args, Number(c.req.query('limit') ?? 100)).all();
    return ok(c, rows);
  }));
  app.post('/api/v1/parties', requirePerm('parties.write'), (c) => handle(c, async () => {
    const input = partySchema.parse(await c.req.json());
    return ok(c, await postParty(c, input), 201);
  }));
  app.get('/api/v1/parties/:id', requirePerm('parties.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const party = await db.prepare('SELECT * FROM parties WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!party) return fail(c, 404, 'NOT_FOUND', 'فریق نہیں ملا', 'Party not found');
    const balance = await db.prepare('SELECT balance_paisa FROM party_balance WHERE party_id=?').bind(party.id).first<{ balance_paisa: number }>();
    const ledger = await db.prepare('SELECT * FROM party_ledger WHERE party_id=? ORDER BY date DESC, id DESC LIMIT 100').bind(party.id).all();
    const allocations = await db.prepare(`SELECT a.* FROM payment_allocations a
      JOIN receipts r ON r.id=a.receipt_id WHERE r.party_id=? LIMIT 100`).bind(party.id).all();
    return ok(c, { ...party, balance_paisa: balance?.balance_paisa ?? 0, ledger, allocations });
  }));

  // --------------------------- receipts / payments ----------------------------
  app.post('/api/v1/receipts', requirePerm('receipts.post'), (c) => handle(c, async () => {
    const input = receiptSchema.parse(await c.req.json());
    return ok(c, await postReceipt(c, input, false), 201);
  }));
  app.post('/api/v1/payments', requirePerm('payments.post'), (c) => handle(c, async () => {
    const input = paymentSchema.parse(await c.req.json());
    return ok(c, await postReceipt(c, input, true), 201);
  }));
  app.get('/api/v1/receipts', requirePerm('khata.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM receipts ORDER BY date DESC, created_at DESC LIMIT 100').all())));
  app.get('/api/v1/payments', requirePerm('khata.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM payments ORDER BY date DESC, created_at DESC LIMIT 100').all())));

  // ------------------------------- money books --------------------------------
  app.get('/api/v1/accounts', requirePerm('accounts.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT fa.*,COALESCE(ab.balance_paisa,0) AS balance_paisa,
      (SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_paisa ELSE 0 END),0) FROM account_transactions t
        WHERE t.account_id=fa.id AND t.date>=date('now','start of month')) AS month_in,
      (SELECT COALESCE(SUM(CASE WHEN direction='OUT' THEN amount_paisa ELSE 0 END),0) FROM account_transactions t
        WHERE t.account_id=fa.id AND t.date>=date('now','start of month')) AS month_out
      FROM financial_accounts fa LEFT JOIN account_balance ab ON ab.account_id=fa.id ORDER BY fa.code`).all();
    return ok(c, rows);
  }));
  app.get('/api/v1/accounts/:id', requirePerm('accounts.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const account = await db.prepare('SELECT * FROM financial_accounts WHERE id=? OR code=?').bind(c.req.param('id'), c.req.param('id')).first<any>();
    if (!account) return fail(c, 404, 'NOT_FOUND', 'اکاؤنٹ نہیں ملا', 'Account not found');
    const balance = await db.prepare('SELECT balance_paisa FROM account_balance WHERE account_id=?').bind(account.id).first<{ balance_paisa: number }>();
    const txns = await db.prepare('SELECT * FROM account_transactions WHERE account_id=? ORDER BY date DESC, created_at DESC LIMIT 200')
      .bind(account.id).all();
    const reconciliations = await db.prepare('SELECT * FROM account_reconciliations WHERE account_id=? ORDER BY period DESC LIMIT 24').bind(account.id).all();
    return ok(c, { ...account, balance_paisa: balance?.balance_paisa ?? 0, transactions: txns, reconciliations });
  }));
  app.post('/api/v1/transfers', requirePerm('transfers.post'), (c) => handle(c, async () => {
    const input = transferSchema.parse(await c.req.json());
    return ok(c, await postTransfer(c, input), 201);
  }));
  app.post('/api/v1/jazzcash', requirePerm('accounts.write'), (c) => handle(c, async () => {
    const input = jazzSchema.parse(await c.req.json());
    return ok(c, await postJazz(c, input), 201);
  }));
  app.post('/api/v1/reconcile', requirePerm('reconcile.write'), (c) => handle(c, async () => {
    const input = reconcileSchema.parse(await c.req.json());
    return ok(c, await postReconciliation(c, input), 201);
  }));

  // --------------------------- expenses / payroll -----------------------------
  app.post('/api/v1/expenses', requirePerm('expenses.post'), (c) => handle(c, async () => {
    const input = expenseSchema.parse(await c.req.json());
    return ok(c, await postExpense(c, input), 201);
  }));
  app.get('/api/v1/expenses', requirePerm('expenses.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const from = c.req.query('from'), to = c.req.query('to');
    const rows = await db.prepare(`SELECT e.*,ec.name_ur AS category_ur FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
      WHERE (? IS NULL OR e.date>=?) AND (? IS NULL OR e.date<=?) ORDER BY e.date DESC, e.created_at DESC LIMIT 200`)
      .bind(from ?? null, from ?? null, to ?? null, to ?? null).all();
    return ok(c, rows);
  }));
  app.get('/api/v1/expense-categories', requirePerm('expenses.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM expense_categories ORDER BY name_ur').all())));
  app.get('/api/v1/employees', requirePerm('employees.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM employees ORDER BY name').all())));
  app.post('/api/v1/employees', requirePerm('employees.write'), (c) => handle(c, async () => {
    const input = employeeSchema.parse(await c.req.json());
    const db = c.get('db')!; const id = ulid();
    await db.prepare(`INSERT INTO employees (id,name,role,phone,join_date,base_salary_paisa,status,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,1)`).bind(id, input.name, input.role, input.phone, input.join_date,
      input.base_salary_paisa, input.status, nowIso(), nowIso()).run();
    await audit(db, 'CREATE', 'employees', id, { user_id: me(c).id });
    return ok(c, { id }, 201);
  }));
  app.post('/api/v1/advances', requirePerm('employees.write'), (c) => handle(c, async () => {
    const input = advanceSchema.parse(await c.req.json());
    return ok(c, await postAdvance(c, input), 201);
  }));
  app.get('/api/v1/advances', requirePerm('employees.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM employee_advances ORDER BY date DESC LIMIT 100').all())));
  app.post('/api/v1/payroll', requirePerm('payroll.post'), (c) => handle(c, async () => {
    const input = payrollSchema.parse(await c.req.json());
    return ok(c, await postPayroll(c, input), 201);
  }));
  app.get('/api/v1/payroll/:ym', requirePerm('employees.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM salary_records WHERE ym=? ORDER BY employee_id').bind(c.req.param('ym')).all())));

  // ---------------------------------- stock -----------------------------------
  app.get('/api/v1/stock', requirePerm('stock.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT p.id,p.name_ur,p.base_unit,p.reorder_level_milli,cat.book_code,cat.name_ur AS category_ur,
      COALESCE(sb.qty_milli,0) AS qty_milli, COALESCE(sb.value_paisa,0) AS value_paisa
      FROM products p JOIN product_categories cat ON cat.id=p.category_id
      LEFT JOIN stock_balance sb ON sb.product_id=p.id
      WHERE p.is_active=1 ORDER BY cat.book_code,p.name_ur LIMIT 500`).all();
    return ok(c, rows);
  }));
  app.get('/api/v1/stock/ledger', requirePerm('stock.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const product = c.req.query('product');
    if (!product) throw new BizError(400, 'PRODUCT_REQUIRED', 'مصنوعات منتخب کریں', 'product query parameter required');
    const rows = await db.prepare(`SELECT * FROM stock_movements WHERE product_id=? ORDER BY date DESC, created_at DESC LIMIT 200`).bind(product).all();
    return ok(c, rows);
  }));
  app.get('/api/v1/stock/batches', requirePerm('stock.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    return ok(c, await db.prepare(`SELECT pb.*,p.name_ur,COALESCE(sbb.qty_milli,0) AS qty_milli
      FROM product_batches pb JOIN products p ON p.id=pb.product_id
      LEFT JOIN stock_batch_balance sbb ON sbb.batch_id=pb.id
      ORDER BY pb.expiry_date IS NULL, pb.expiry_date LIMIT 200`).all());
  }));
  app.post('/api/v1/stock/opening', requirePerm('stock.adjust'), (c) => handle(c, async () => {
    const input = stockOpeningSchema.parse(await c.req.json());
    return ok(c, await postStockOpening(c, input), 201);
  }));
  app.post('/api/v1/stock/adjustment', requirePerm('stock.adjust'), (c) => handle(c, async () => {
    const input = stockAdjustmentSchema.parse(await c.req.json());
    return ok(c, await postStockAdjustment(c, input), 201);
  }));
  app.post('/api/v1/stock/count', requirePerm('stock.count'), (c) => handle(c, async () => {
    const input = stockCountSchema.parse(await c.req.json());
    return ok(c, await postStockCount(c, input), 201);
  }));

  // -------------------------------- accounting -------------------------------
  app.post('/api/v1/accounting/journal', requirePerm('accounting.post'), (c) => handle(c, async () => {
    const input = manualJournalSchema.parse(await c.req.json());
    return ok(c, await postManualJournal(c, input), 201);
  }));
  app.post('/api/v1/accounting/period-close', requirePerm('period.close'), (c) => handle(c, async () => {
    const input = periodCloseSchema.parse(await c.req.json());
    const db = c.get('db')!;
    await db.prepare('INSERT INTO accounting_periods (ym,closed_at,closed_by,reason) VALUES (?,?,?,?)')
      .bind(input.ym, nowIso(), me(c).id, input.reason).run();
    await audit(db, 'PERIOD_CLOSE', 'accounting_periods', input.ym, { user_id: me(c).id, reason: input.reason });
    return ok(c, { ym: input.ym, closed: true });
  }));
}
