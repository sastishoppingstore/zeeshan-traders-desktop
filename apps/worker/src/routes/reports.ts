/** Dashboard (pre-aggregated), khata, financial statements, registers, documents, integrity. */
import type { Hono } from 'hono';
import type { AppEnv, AppVars } from '../context.js';
import { ok, fail, handle, requirePerm, getSetting, nowIso, toCsv, BizError, rateLimit, clientIp } from '../context.js';
import { BOOKS, CROP_CODES, MONEY_ACCOUNTS, TEMPLATE_VERSION } from '@zt/shared';
import type { DocumentSnapshot } from '@zt/shared';
import type { DB } from '../db.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

function range(c: any): { from: string; to: string } {
  const to = c.req.query('to') ?? new Date().toISOString().slice(0, 10);
  const from = c.req.query('from') ?? to;
  return { from, to };
}
const sum = (rows: any[], key: string) => rows.reduce((a, r) => a + (r[key] ?? 0), 0);

export function registerReports(app: H) {
  // --------------------------------- Dashboard --------------------------------
  app.get('/api/v1/dashboard', requirePerm('dashboard.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const accounts = await db.prepare(`SELECT fa.code,fa.name_ur,fa.id,COALESCE(ab.balance_paisa,0) balance_paisa,
      (SELECT COALESCE(SUM(CASE WHEN t.direction='IN' THEN t.amount_paisa ELSE 0 END),0) FROM account_transactions t WHERE t.account_id=fa.id AND t.date>=? AND t.date<=?) today_in,
      (SELECT COALESCE(SUM(CASE WHEN t.direction='OUT' THEN t.amount_paisa ELSE 0 END),0) FROM account_transactions t WHERE t.account_id=fa.id AND t.date>=? AND t.date<=?) today_out
      FROM financial_accounts fa LEFT JOIN account_balance ab ON ab.account_id=fa.id ORDER BY fa.code`)
      .bind(from, to, from, to).all<any>();
    const credit = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN balance_paisa>0 THEN balance_paisa ELSE 0 END),0) receivable_paisa,
      COALESCE(SUM(CASE WHEN balance_paisa<0 THEN -balance_paisa ELSE 0 END),0) payable_paisa
      FROM party_balance`).first<any>();
    const summary = await db.prepare(`SELECT book_code,metric,SUM(value_paisa) paisa,SUM(value_milli) milli
      FROM daily_summary WHERE date>=? AND date<=? GROUP BY book_code,metric LIMIT 500`).bind(from, to).all<any>();
    const byMetric = (m: string) => sum(summary.filter((s) => s.metric === m), 'paisa');
    const stockByBook = await db.prepare(`SELECT cat.book_code,SUM(COALESCE(sb.qty_milli,0)) qty_milli,SUM(COALESCE(sb.value_paisa,0)) value_paisa
      FROM products p JOIN product_categories cat ON cat.id=p.category_id
      LEFT JOIN stock_balance sb ON sb.product_id=p.id
      WHERE cat.book_code IS NOT NULL GROUP BY cat.book_code LIMIT 50`).all<any>();
    const books = BOOKS.map((b) => {
      const s = summary.filter((x) => x.book_code === b.code);
      const st = stockByBook.find((x) => x.book_code === b.code);
      return {
        code: b.code, ur: b.ur, en: b.en, kind: b.kind,
        stock_value_paisa: st?.value_paisa ?? 0, stock_qty_milli: st?.qty_milli ?? 0,
        today_sale_paisa: sum(s.filter((x) => x.metric === 'SALE'), 'paisa'),
        today_purchase_paisa: sum(s.filter((x) => x.metric === 'PURCHASE'), 'paisa'),
        today_purchase_qty_milli: sum(s.filter((x) => x.metric === 'PURCHASE'), 'milli'),
        today_sale_qty_milli: sum(s.filter((x) => x.metric === 'SALE'), 'milli'),
        receivable_paisa: sum(s.filter((x) => x.metric === 'RECEIVABLE'), 'paisa'),
        gross_profit_paisa: sum(s.filter((x) => x.metric === 'SALE'), 'paisa') - sum(s.filter((x) => x.metric === 'COGS'), 'paisa'),
      };
    });
    const recent = await db.prepare(
      `SELECT id,number,date,type AS kind,amount_paisa,party_id,created_at FROM documents ORDER BY created_at DESC LIMIT 15`
    ).all<any>();
    const alerts = await db.prepare(`SELECT 'LOW_STOCK' type,p.name_ur title_ur FROM products p
      JOIN stock_balance sb ON sb.product_id=p.id WHERE p.reorder_level_milli>0 AND sb.qty_milli<p.reorder_level_milli LIMIT 20`).all<any>();
    const nearDays = (await getSetting<number>(db, 'near_expiry_days')) ?? 90;
    const expiryAlerts = await db.prepare(`SELECT pb.id,pb.batch_no,pb.expiry_date,p.name_ur,
      CASE WHEN pb.expiry_date < date('now') THEN 'EXPIRED' ELSE 'NEAR_EXPIRY' END type
      FROM product_batches pb JOIN products p ON p.id=pb.product_id
      WHERE pb.expiry_date IS NOT NULL AND pb.expiry_date <= date('now', ? || ' days') LIMIT 50`)
      .bind(String(nearDays)).all<any>();
    const counts = {
      pending_enquiries: (await db.prepare("SELECT COUNT(*) n FROM website_enquiries WHERE status='NEW'").first<{ n: number }>())?.n ?? 0,
      pending_orders: (await db.prepare("SELECT COUNT(*) n FROM orders WHERE status='NEW'").first<{ n: number }>())?.n ?? 0,
      total_orders: (await db.prepare("SELECT COUNT(*) n FROM orders").first<{ n: number }>())?.n ?? 0,
      total_products: (await db.prepare("SELECT COUNT(*) n FROM products WHERE deleted=0").first<{ n: number }>())?.n ?? 0,
      total_stock_value: (await db.prepare("SELECT COALESCE(SUM(value_paisa),0) v FROM stock_balance").first<{ v: number }>())?.v ?? 0,
      pending_sync: (await db.prepare("SELECT COUNT(*) n FROM sync_operations WHERE status IN ('PENDING','CONFLICT')").first<{ n: number }>())?.n ?? 0,
      conflicts: (await db.prepare("SELECT COUNT(*) n FROM sync_conflicts WHERE status='OPEN'").first<{ n: number }>())?.n ?? 0,
    };
    const licExp = await getSetting<string>(db, 'pesticide_licence_expiry');
    if (licExp && licExp <= new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)) {
      alerts.push({ type: 'LICENCE_EXPIRY', title_ur: 'پیسٹی سائیڈ لائسنس کی میعاد قریب ہے' });
    }
    const charts = await db.prepare(`SELECT date,metric,SUM(value_paisa) paisa FROM daily_summary
      WHERE date>=date('now','-30 days') AND metric IN ('SALE','PURCHASE','CASH_IN','CASH_OUT','EXPENSE')
      GROUP BY date,metric ORDER BY date LIMIT 500`).all<any>();
    const liveTodaySale = (await db.prepare("SELECT COALESCE(SUM(total_paisa),0) s FROM sales WHERE status='POSTED' AND date>=? AND date<=?").bind(from, to).first<{ s: number }>())?.s ?? 0;
    const liveTodayPurch = (await db.prepare("SELECT COALESCE(SUM(total_paisa),0) p FROM purchases WHERE status='POSTED' AND date>=? AND date<=?").bind(from, to).first<{ p: number }>())?.p ?? 0;
    const effSalePaisa = Math.max(byMetric('SALE'), liveTodaySale);
    const effPurchPaisa = Math.max(byMetric('PURCHASE'), liveTodayPurch);
    return ok(c, {
      from, to, accounts, credit,
      today: {
        sales_paisa: effSalePaisa, purchases_paisa: effPurchPaisa,
        collections_paisa: byMetric('CASH_IN'), payments_paisa: byMetric('CASH_OUT'),
        expenses_paisa: byMetric('EXPENSE'), cogs_paisa: byMetric('COGS'),
        gross_profit_paisa: byMetric('SALE') - byMetric('COGS'),
      },
      books, grains: books.filter((b) => (CROP_CODES as readonly string[]).includes(b.code)),
      alerts: [...alerts, ...expiryAlerts], counts, recent, charts,
      pending_offline: counts.pending_sync,
    });
  }));

  // ---------------------------------- Khata -----------------------------------
  app.get('/api/v1/khata', requirePerm('khata.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const book = c.req.query('book') ?? '';
    const party = c.req.query('party') ?? '';
    const money = MONEY_ACCOUNTS.find((m) => m.code === book || book === `acct-${m.code.toLowerCase()}`);
    if (money) {
      const rows = await db.prepare(`SELECT t.*,fa.code account_code FROM account_transactions t
        JOIN financial_accounts fa ON fa.id=t.account_id
        WHERE fa.code=? AND t.date>=? AND t.date<=? ORDER BY t.date, t.created_at LIMIT 500`)
        .bind(money.code, from, to).all<any>();
      const opening = (await db.prepare('SELECT balance_paisa FROM account_balance WHERE account_id=?').bind(`acct-${money.code.toLowerCase()}`).first<{ balance_paisa: number }>())?.balance_paisa ?? 0;
      let running = 0;
      const withBalance = rows.map((r) => { running += r.direction === 'IN' ? r.amount_paisa : -r.amount_paisa; return { ...r, running_paisa: running }; });
      return ok(c, { kind: 'MONEY', book: money.code, rows, withBalance, opening_paisa: opening,
        debit_paisa: sum(rows.filter((r) => r.direction === 'IN'), 'amount_paisa'),
        credit_paisa: sum(rows.filter((r) => r.direction === 'OUT'), 'amount_paisa') });
    }
    const where = ['l.date>=?', 'l.date<=?']; const args: (string | number)[] = [from, to];
    if (book) { where.push('l.book_code=?'); args.push(book); }
    if (party) { where.push('l.party_id=?'); args.push(party); }
    const rows = await db.prepare(`SELECT l.*,p.name_ur party_name FROM party_ledger l JOIN parties p ON p.id=l.party_id
      WHERE ${where.join(' AND ')} ORDER BY l.date, l.created_at LIMIT 500`).bind(...args).all<any>();
    let running = 0;
    const withBalance = rows.map((r) => { running += r.debit_paisa - r.credit_paisa; return { ...r, running_paisa: running }; });
    const balance = await db.prepare('SELECT balance_paisa FROM party_balance WHERE party_id=?').bind(party || '__none__').first<{ balance_paisa: number }>();
    return ok(c, { kind: 'PARTY_OR_BOOK', book, rows, withBalance,
      debit_paisa: sum(rows, 'debit_paisa'), credit_paisa: sum(rows, 'credit_paisa'),
      closing_balance_paisa: party ? balance?.balance_paisa ?? 0 : running });
  }));

  app.get('/api/v1/khata/books', requirePerm('khata.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT book_code,SUM(debit_paisa) debit_paisa,SUM(credit_paisa) credit_paisa,
      SUM(debit_paisa-credit_paisa) balance_paisa FROM party_ledger GROUP BY book_code LIMIT 100`).all();
    const money = await db.prepare(`SELECT fa.code book_code,
      COALESCE(SUM(CASE WHEN t.direction='IN' THEN t.amount_paisa ELSE 0 END),0) debit_paisa,
      COALESCE(SUM(CASE WHEN t.direction='OUT' THEN t.amount_paisa ELSE 0 END),0) credit_paisa,
      COALESCE(ab.balance_paisa,0) balance_paisa
      FROM financial_accounts fa LEFT JOIN account_transactions t ON t.account_id=fa.id
      LEFT JOIN account_balance ab ON ab.account_id=fa.id GROUP BY fa.id LIMIT 20`).all();
    return ok(c, { books: rows, money_books: money });
  }));

  app.get('/api/v1/khata/ageing', requirePerm('khata.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT p.id,p.name_ur,p.type,pb.balance_paisa,
      MAX(l.date) last_date FROM parties p JOIN party_balance pb ON pb.party_id=p.id
      LEFT JOIN party_ledger l ON l.party_id=p.id WHERE pb.balance_paisa>0
      GROUP BY p.id LIMIT 200`).all<any>();
    const today = Date.now();
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const debtors = rows.map((r) => {
      const days = r.last_date ? Math.floor((today - new Date(r.last_date).getTime()) / 86400_000) : 999;
      const bucket = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      buckets[bucket] += r.balance_paisa;
      return { ...r, days, bucket };
    });
    return ok(c, { debtors, buckets });
  }));

  // --------------------------- Financial statements ---------------------------
  app.get('/api/v1/reports/trial-balance', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT jl.account_code,co.name_ur,co.type,
      SUM(jl.debit_paisa) debit_paisa,SUM(jl.credit_paisa) credit_paisa
      FROM journal_lines jl JOIN chart_of_accounts co ON co.code=jl.account_code
      GROUP BY jl.account_code ORDER BY jl.account_code LIMIT 200`).all<any>();
    const totals = { debit_paisa: sum(rows, 'debit_paisa'), credit_paisa: sum(rows, 'credit_paisa') };
    return ok(c, { rows, totals, balanced: totals.debit_paisa === totals.credit_paisa });
  }));

  app.get('/api/v1/reports/pnl', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const book = c.req.query('book') ?? '';
    const args: (string | number)[] = [from, to];
    let extra = '';
    if (book) { extra = ' AND jl.book_code=?'; args.push(book); }
    const rows = await db.prepare(`SELECT jl.account_code,co.name_ur,co.type,
      SUM(jl.debit_paisa) debit_paisa,SUM(jl.credit_paisa) credit_paisa
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
      JOIN chart_of_accounts co ON co.code=jl.account_code
      WHERE je.date>=? AND je.date<=?${extra} AND co.type IN ('income','expense')
      GROUP BY jl.account_code ORDER BY jl.account_code LIMIT 200`).bind(...args).all<any>();
    const income = sum(rows.filter((r) => r.type === 'income'), 'credit_paisa') - sum(rows.filter((r) => r.type === 'income'), 'debit_paisa');
    const expenses = sum(rows.filter((r) => r.type === 'expense'), 'debit_paisa') - sum(rows.filter((r) => r.type === 'expense'), 'credit_paisa');
    const perBook = await db.prepare(`SELECT jl.book_code,SUM(jl.credit_paisa-jl.debit_paisa) profit_paisa
      FROM journal_lines jl JOIN chart_of_accounts co ON co.code=jl.account_code
      JOIN journal_entries je ON je.id=jl.entry_id WHERE co.type='income' AND je.date>=? AND je.date<=?
      GROUP BY jl.book_code LIMIT 50`).bind(from, to).all();
    return ok(c, { from, to, book: book || 'ALL', rows, income_paisa: income, expenses_paisa: expenses,
      net_profit_paisa: income - expenses, per_book: perBook });
  }));

  app.get('/api/v1/reports/balance-sheet', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { to } = range(c);
    const rows = await db.prepare(`SELECT jl.account_code,co.name_ur,co.type,
      SUM(jl.debit_paisa-jl.credit_paisa) balance_paisa
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
      JOIN chart_of_accounts co ON co.code=jl.account_code WHERE je.date<=?
      GROUP BY jl.account_code LIMIT 200`).bind(to).all<any>();
    const pnl = await db.prepare(`SELECT SUM(jl.credit_paisa-jl.debit_paisa) v FROM journal_lines jl
      JOIN chart_of_accounts co ON co.code=jl.account_code JOIN journal_entries je ON je.id=jl.entry_id
      WHERE co.type IN ('income','expense') AND je.date<=?`).bind(to).first<{ v: number }>();
    const assets = sum(rows.filter((r) => r.type === 'asset'), 'balance_paisa');
    const liabilities = -sum(rows.filter((r) => r.type === 'liability'), 'balance_paisa');
    const equity = -sum(rows.filter((r) => r.type === 'equity'), 'balance_paisa') + (pnl?.v ?? 0);
    return ok(c, { as_of: to, rows, assets_paisa: assets, liabilities_paisa: liabilities,
      equity_paisa: equity, difference_paisa: assets - liabilities - equity,
      balanced: Math.abs(assets - liabilities - equity) === 0 });
  }));

  app.get('/api/v1/reports/daybook', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const entries = await db.prepare('SELECT * FROM journal_entries WHERE date>=? AND date<=? ORDER BY date DESC, created_at DESC LIMIT 100')
      .bind(from, to).all<any>();
    const ids = entries.map((e) => e.id);
    const lines = ids.length
      ? await db.prepare(`SELECT * FROM journal_lines WHERE entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY entry_id`).bind(...ids).all<any>()
      : [];
    return ok(c, entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entry_id === e.id) })));
  }));

  app.get('/api/v1/reports/cashbook', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const rows = await db.prepare(`SELECT t.*,fa.name_ur account_name FROM account_transactions t
      JOIN financial_accounts fa ON fa.id=t.account_id WHERE t.date>=? AND t.date<=?
      ORDER BY t.date, t.created_at LIMIT 500`).bind(from, to).all();
    return ok(c, rows);
  }));

  app.get('/api/v1/reports/stock', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT p.id,p.name_ur,cat.name_ur category_ur,cat.book_code,
      COALESCE(sb.qty_milli,0) qty_milli,COALESCE(sb.value_paisa,0) value_paisa,p.reorder_level_milli
      FROM products p JOIN product_categories cat ON cat.id=p.category_id
      LEFT JOIN stock_balance sb ON sb.product_id=p.id ORDER BY cat.book_code,p.name_ur LIMIT 500`).all();
    return ok(c, rows);
  }));

  app.get('/api/v1/reports/expiry', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    return ok(c, await db.prepare(`SELECT pb.*,p.name_ur product_ur,COALESCE(sbb.qty_milli,0) qty_milli
      FROM product_batches pb JOIN products p ON p.id=pb.product_id
      LEFT JOIN stock_batch_balance sbb ON sbb.batch_id=pb.id
      WHERE pb.expiry_date IS NOT NULL ORDER BY pb.expiry_date LIMIT 200`).all());
  }));

  /** Legal-style sale registers: buyer name/mobile/address + product + batch + qty + date. */
  app.get('/api/v1/reports/pesticide-register', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const rows = await db.prepare(`SELECT s.date,s.number,s.buyer_name,s.buyer_mobile,s.buyer_address,
      si.qty_milli,p.name_ur product_ur,pb.batch_no,pb.expiry_date,si.rate_paisa,si.line_total_paisa
      FROM sales s JOIN sale_items si ON si.sale_id=s.id JOIN products p ON p.id=si.product_id
      LEFT JOIN product_batches pb ON pb.id=si.batch_id
      WHERE s.book_code='PEST' AND s.status='POSTED' AND s.date>=? AND s.date<=?
      ORDER BY s.date,s.number LIMIT 500`).bind(from, to).all();
    if (c.req.query('format') === 'csv') return new Response('\uFEFF' + toCsv(rows as any), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    return ok(c, rows);
  }));
  app.get('/api/v1/reports/fertilizer-register', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const rows = await db.prepare(`SELECT s.date,s.number,s.buyer_name,s.buyer_mobile,s.buyer_address,
      si.qty_milli,p.name_ur product_ur,si.rate_paisa,si.line_total_paisa,s.paid_paisa,s.due_paisa
      FROM sales s JOIN sale_items si ON si.sale_id=s.id JOIN products p ON p.id=si.product_id
      WHERE s.book_code='FERT' AND s.status='POSTED' AND s.date>=? AND s.date<=?
      ORDER BY s.date,s.number LIMIT 500`).bind(from, to).all();
    if (c.req.query('format') === 'csv') return new Response('\uFEFF' + toCsv(rows as any), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    return ok(c, rows);
  }));

  /** Three-way reconciliation: dashboard = reports = ledger sums. */
  app.get('/api/v1/reports/reconcile', requirePerm('reports.view'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const dash = await db.prepare(`SELECT SUM(value_paisa) v FROM daily_summary WHERE metric='SALE' AND date>=? AND date<=?`).bind(from, to).first<{ v: number }>();
    const docs = await db.prepare(`SELECT COALESCE(SUM(total_paisa),0) v FROM sales WHERE status='POSTED' AND date>=? AND date<=?`).bind(from, to).first<{ v: number }>();
    const ledger = await db.prepare(`SELECT COALESCE(SUM(debit_paisa),0) v FROM party_ledger WHERE ref_type IN ('SALE','GRAIN_SALE') AND date>=? AND date<=?`).bind(from, to).first<{ v: number }>();
    const journal = await db.prepare(`SELECT COALESCE(SUM(jl.credit_paisa-jl.debit_paisa),0) v FROM journal_lines jl
      JOIN chart_of_accounts co ON co.code=jl.account_code JOIN journal_entries je ON je.id=jl.entry_id
      WHERE co.type='income' AND je.date>=? AND je.date<=?`).bind(from, to).first<{ v: number }>();
    const values = { dashboard: dash?.v ?? 0, documents: docs?.v ?? 0, party_ledger: ledger?.v ?? 0, journal: journal?.v ?? 0 };
    const equal = new Set(Object.values(values)).size === 1;
    return ok(c, { from, to, values, equal });
  }));

  // --------------------------------- Documents --------------------------------
  app.get('/api/v1/documents', requirePerm('documents.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const q = (c.req.query('q') ?? '').trim();
    const type = c.req.query('type') ?? '';
    const { from, to } = range(c);
    const where = ['date>=?', 'date<=?']; const args: (string | number)[] = [from, to];
    if (type) { where.push('type=?'); args.push(type); }
    if (q) { where.push('(number LIKE ? OR snapshot_json LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const rows = await db.prepare(`SELECT id,type,number,party_id,date,amount_paisa,book_code,ref_id,template_version,created_at
      FROM documents WHERE ${where.join(' AND ')} ORDER BY date DESC, created_at DESC LIMIT 100`).bind(...args).all();
    return ok(c, rows);
  }));
  app.get('/api/v1/documents/:id', requirePerm('documents.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare('SELECT * FROM documents WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'دستاویز نہیں ملی', 'Document not found');
    return ok(c, { ...row, snapshot: JSON.parse(row.snapshot_json) as DocumentSnapshot });
  }));
  /**
   * Public: the owner scans the QR printed on an invoice and lands on a read-only verification page.
   * The response is an explicit whitelist — it NEVER exposes cost, margin, exact stock, supplier,
   * ledger balances, or the party's phone/address/CNIC. The 26-char ULID in the URL is the only
   * capability, and it is rate-limited per client so ids cannot be enumerated at speed.
   */
  app.get('/api/v1/public/invoice/:id', (c) => handle(c, async () => {
    const db = c.get('db')!;
    if (!(await rateLimit(db, `invoice-verify:${clientIp(c)}`, 60, 60_000))) {
      return fail(c, 429, 'RATE_LIMITED', 'بہت زیادہ تصدیقی درخواستیں — تھوڑی دیر بعد کوشش کریں', 'Too many verification requests.');
    }
    const row = await db.prepare(`SELECT id,type,number,date,amount_paisa,snapshot_json,template_version,created_at
      FROM documents WHERE id=?`).bind(c.req.param('id')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'اس کاروبار میں ایسی کوئی دستاویز نہیں ملی', 'Invoice not found in this business.');
    let s: any = {};
    try { s = JSON.parse(row.snapshot_json); } catch { s = {}; }
    const business = s.business ?? {};
    return ok(c, {
      verified: true, id: row.id, number: row.number, type: row.type, date: row.date,
      amount_paisa: row.amount_paisa ?? s.total_paisa ?? 0, currency: 'PKR',
      template_version: row.template_version, issued_at: row.created_at ?? null,
      business_name_ur: business.name_ur ?? null, business_name_en: business.name_en ?? null,
      business_location: business.location_ur ?? null, business_phone: business.phone1 ?? null,
      party_name: s.party?.name ?? null, title_ur: s.title_ur ?? null,
      lines: Array.isArray(s.lines) ? s.lines.map((l: any) => ({
        label: l.label, qty: l.qty, rate: l.rate, amount_paisa: l.amount_paisa,
      })) : [],
      subtotal_paisa: s.subtotal_paisa ?? null, total_paisa: s.total_paisa ?? row.amount_paisa ?? null,
      paid_paisa: s.paid_paisa ?? null, due_paisa: s.due_paisa ?? null,
      payment_method: s.payment_method ?? null, note: s.note ?? null, book_code: s.book_code ?? null,
    });
  }));
  /** Re-render a khata/party/book statement from stored data (browser shapes Urdu). */
  // Separate path so /documents/:id cannot capture it.
  app.get('/api/v1/statements', requirePerm('documents.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const partyId = c.req.query('party_id'), book = c.req.query('book') ?? '';
    const where = ['l.date>=?', 'l.date<=?']; const args: (string | number)[] = [from, to];
    if (partyId) { where.push('l.party_id=?'); args.push(partyId); }
    if (book) { where.push('l.book_code=?'); args.push(book); }
    const rows = await db.prepare(`SELECT l.*,p.name_ur party_name FROM party_ledger l JOIN parties p ON p.id=l.party_id
      WHERE ${where.join(' AND ')} ORDER BY l.date,l.created_at LIMIT 500`).bind(...args).all<any>();
    let running = 0;
    const lines = rows.map((r) => {
      running += r.debit_paisa - r.credit_paisa;
      return { label: `${r.description_ur} (${r.ref_type})`, qty: '', rate: '',
        amount_paisa: r.debit_paisa - r.credit_paisa, running_paisa: running };
    });
    const business = await getSetting<any>(db, 'business');
    const snapshot: DocumentSnapshot = {
      template_version: TEMPLATE_VERSION, document_type: 'KHATA_STATEMENT',
      number: `STMT-${from}-${to}`, date: to,
      business: { name_ur: business?.name_ur ?? 'ذیشان ٹریڈرز', name_en: business?.name_en ?? 'Zeeshan Traders',
        location_ur: business?.location_ur ?? '', phone1: business?.phone1 ?? '', phone2: business?.phone2 ?? '' },
      party: { name: partyId ? rows[0]?.party_name ?? '' : book || 'تمام کھاتے' },
      title_ur: 'کھاتہ اسٹیٹمنٹ', lines, subtotal_paisa: sum(rows, 'debit_paisa'),
      extras: [{ label: 'کریڈٹ / Credit', amount_paisa: -sum(rows, 'credit_paisa') }],
      total_paisa: running, paid_paisa: 0, due_paisa: 0, payment_method: '',
      book_code: book || undefined,
    };
    return ok(c, { snapshot, count: rows.length });
  }));

  app.get('/api/v1/accounting/chart', requirePerm('accounting.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM chart_of_accounts WHERE deleted=0 ORDER BY code LIMIT 200').all())));
  app.get('/api/v1/accounting/journals', requirePerm('accounting.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { from, to } = range(c);
    const entries = await db.prepare('SELECT * FROM journal_entries WHERE date>=? AND date<=? ORDER BY date DESC LIMIT 100').bind(from, to).all<any>();
    return ok(c, entries);
  }));
  app.get('/api/v1/audit', requirePerm('audit.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    return ok(c, await db.prepare('SELECT * FROM audit_logs ORDER BY at DESC LIMIT 200').all());
  }));

  // ------------------------------- Integrity job ------------------------------
  app.get('/api/v1/integrity', requirePerm('accounting.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const result = await runIntegrity(db);
    return ok(c, result);
  }));
  app.post('/api/v1/integrity/run', requirePerm('accounting.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const result = await runIntegrity(db);
    await db.prepare('INSERT INTO job_runs (id,job,at,result,details_json) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), 'integrity', nowIso(), result.ok ? 'PASS' : 'FAIL', JSON.stringify(result)).run();
    return ok(c, result);
  }));
}

/** H4 / nightly integrity: journals balance, stock ledger = stock balance,
 *  account balance = transactions, party balance = party ledger, trial balance. */
export async function runIntegrity(db: DB) {
  const problems: string[] = [];
  const unbalanced = await db.prepare(`SELECT entry_id,SUM(debit_paisa) d,SUM(credit_paisa) c FROM journal_lines
    GROUP BY entry_id HAVING SUM(debit_paisa)<>SUM(credit_paisa) LIMIT 20`).all<any>();
  if (unbalanced.length) problems.push(`unbalanced journals: ${unbalanced.length}`);
  const tb = await db.prepare('SELECT SUM(debit_paisa) d,SUM(credit_paisa) c FROM journal_lines').first<any>();
  if ((tb?.d ?? 0) !== (tb?.c ?? 0)) problems.push('trial balance debits != credits');
  const stockDiff = await db.prepare(`SELECT m.product_id,m.movements,s.qty_milli FROM
    (SELECT product_id,SUM(qty_in_milli-qty_out_milli) movements FROM stock_movements GROUP BY product_id LIMIT 500) m
    LEFT JOIN stock_balance s ON s.product_id=m.product_id
    WHERE COALESCE(s.qty_milli,0)<>m.movements LIMIT 20`).all<any>();
  if (stockDiff.length) problems.push(`stock ledger != stock_balance: ${stockDiff.length}`);
  const acctDiff = await db.prepare(`SELECT t.account_id,t.movements,COALESCE(ab.balance_paisa,0) cached FROM
    (SELECT account_id,SUM(CASE WHEN direction='IN' THEN amount_paisa ELSE -amount_paisa END) movements
      FROM account_transactions GROUP BY account_id LIMIT 50) t
    LEFT JOIN account_balance ab ON ab.account_id=t.account_id
    WHERE COALESCE(ab.balance_paisa,0)<>t.movements LIMIT 20`).all<any>();
  if (acctDiff.length) problems.push(`account balance != transactions: ${acctDiff.length}`);
  const partyDiff = await db.prepare(`SELECT l.party_id,l.movements,COALESCE(pb.balance_paisa,0) cached FROM
    (SELECT party_id,SUM(debit_paisa-credit_paisa) movements FROM party_ledger GROUP BY party_id LIMIT 200) l
    LEFT JOIN party_balance pb ON pb.party_id=l.party_id
    WHERE COALESCE(pb.balance_paisa,0)<>l.movements LIMIT 20`).all<any>();
  if (partyDiff.length) problems.push(`party balance != ledger: ${partyDiff.length}`);
  return {
    ok: problems.length === 0, problems,
    checks: {
      unbalanced_journals: unbalanced.length,
      trial_balance: { debit_paisa: tb?.d ?? 0, credit_paisa: tb?.c ?? 0 },
      stock_mismatches: stockDiff.length, account_mismatches: acctDiff.length, party_mismatches: partyDiff.length,
    },
    at: nowIso(),
  };
}
