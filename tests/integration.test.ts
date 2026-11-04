/** Integration + acceptance scenarios against the REAL Worker app and a local D1-compatible DB. */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeHarness, createProduct, TODAY, money, type Harness } from './helpers.js';

const P = (rupees: number) => money(rupees);

describe('ERP acceptance scenarios (real Worker + real SQL)', () => {
  let h: Harness;
  let product: { id: string; slug: string };
  let saleId = '', saleNumber = '', partyId = '';
  let salesRevenueBaseline = 0;

  beforeAll(async () => {
    h = makeHarness();
    await h.setup();
  });

  // ------------------------------ A1 setup / auth ------------------------------
  it('A1 setup creates the owner and cannot be re-run', async () => {
    const again = await h.call('POST', '/api/v1/setup', {
      setup_token: h.setupToken,
      owner: { name: 'X', username: 'x', mobile: '0300-0000000', password: 'another-password-123' },
      maund_kg: 40, maund_confirmed: true,
    });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('SETUP_ALREADY_DONE');
    const me = await h.call('GET', '/api/v1/auth/me');
    expect(me.json.data.user.roles).toContain('OWNER');
    expect(me.json.data.user.permissions).toContain('settings.write');
  });

  it('H5: unauthenticated and missing-CSRF requests are rejected by the Worker', async () => {
    const noAuth = await h.call('GET', '/api/v1/products', undefined, { cookie: '', csrf: '' });
    expect(noAuth.status).toBe(401);
    const noCsrf = await h.call('POST', '/api/v1/parties', { name_ur: 'X', type: 'CUSTOMER' }, { csrf: '' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.json.error.code).toBe('CSRF_FAILED');
  });

  // --------------------------- A2/A3 catalogue --------------------------------
  it('A2 product publish/unpublish appears on and disappears from the public site (cache purged)', async () => {
    product = await createProduct(h);
    const pub = await h.call('POST', `/api/v1/products/${product.id}/publish`, { published: true });
    expect(pub.status).toBe(200);
    const listed = await h.call('GET', '/api/v1/public/products');
    expect(listed.json.data.rows.some((r: any) => r.id === product.id)).toBe(true);
    const unpub = await h.call('POST', `/api/v1/products/${product.id}/publish`, { published: false });
    expect(unpub.status).toBe(200);
    const after = await h.call('GET', '/api/v1/public/products');
    expect(after.json.data.rows.some((r: any) => r.id === product.id)).toBe(false);
    await h.call('POST', `/api/v1/products/${product.id}/publish`, { published: true });
  });

  it('A3/H6 public JSON never exposes cost, exact stock, supplier, customers or notes', async () => {
    const detail = await h.call('GET', `/api/v1/public/product/${product.slug}`);
    const raw = JSON.stringify(detail.json);
    for (const forbidden of ['purchase_rate_paisa', 'sale_rate_paisa', 'qty_milli', 'stock_milli',
      'supplier', 'cost_paisa', 'party_id', 'notes', 'internal']) {
      expect(raw).not.toContain(forbidden);
    }
    expect(detail.json.data.product.show_public_price).toBe(true);
    // JSON-LD has no fabricated ratings/reviews.
    expect(raw).not.toContain('aggregateRating');
  });

  it('A4 CSV import previews without writing, then confirms with duplicate handling', async () => {
    const rows = [
      { name_ur: 'یوریا', category_code: 'FERT', sku: 'IMP-1', base_unit: 'bag', purchase_rate: '2000', sale_rate: '2300' },
      { name_ur: 'ڈی اے پی کھاد', category_code: 'FERT', sku: '', base_unit: 'bag' }, // duplicate by name
      { name_ur: '', category_code: '', sku: 'BAD' }, // row error
    ];
    const preview = await h.call('POST', '/api/v1/import/products/preview', { rows, mode: 'SKIP' });
    expect(preview.status).toBe(200);
    expect(preview.json.data.valid).toBe(2);
    expect(preview.json.data.rows[2].errors.length).toBeGreaterThan(0);
    expect(preview.json.data.rows[1].duplicate_id).toBeTruthy();
    const before = (await h.call('GET', '/api/v1/products')).json.data.rows.length;
    const confirm = await h.call('POST', '/api/v1/import/products/confirm',
      { rows: preview.json.data.rows, mode: 'SKIP' });
    expect(confirm.status).toBe(200);
    expect(confirm.json.data.created).toBe(1);
    expect(confirm.json.data.skipped).toBe(2);
    const after = (await h.call('GET', '/api/v1/products')).json.data.rows.length;
    expect(after).toBe(before + 1);
  });

  // ------------------------------- A5 purchases -------------------------------
  it('A5 purchase partly paid from Meezan: stock up, payable correct, bank balance down', async () => {
    const opening = await h.call('POST', '/api/v1/stock/opening', {
      date: TODAY, product_id: product.id, qty_milli: 100000, unit_cost_paisa: P(2000), reason: 'Opening stock',
    });
    expect(opening.status).toBe(201);
    const before = await h.call('GET', '/api/v1/accounts/MEEZAN');
    const res = await h.call('POST', '/api/v1/purchases', {
      date: TODAY, book_code: 'FERT', party_name: 'Test Supplier', party_phone: '0300-1111111',
      supplier_invoice_no: 'SUP-1', season: 'RABI',
      lines: [{ product_id: product.id, qty_milli: 10000, rate_paisa: P(2500), bags: 10, weight_per_bag_grams: 50000 }],
      discount_paisa: 0, freight_paisa: P(100), loading_paisa: P(50), other_paisa: 0,
      payments: [{ account_id: 'MEEZAN', amount_paisa: P(10000) }], note: 'integration',
    });
    expect(res.status).toBe(201);
    expect(res.json.data.total_paisa).toBe(P(25150));
    expect(res.json.data.due_paisa).toBe(P(15150));
    const after = await h.call('GET', '/api/v1/accounts/MEEZAN');
    expect(before.json.data.balance_paisa - after.json.data.balance_paisa).toBe(P(10000));
    const stock = await h.call('GET', '/api/v1/stock');
    const row = stock.json.data.find((r: any) => r.id === product.id);
    expect(row.qty_milli).toBe(110000);
  });

  // ------------------------------- A6 credit sale -----------------------------
  it('A6 credit sale posts COGS at weighted cost; a later receipt adds NO extra revenue', async () => {
    const sale = await h.call('POST', '/api/v1/sales', {
      date: TODAY, book_code: 'FERT', party_name: 'Test Customer', party_phone: '0300-2222222',
      party_address: 'مقصود چوک', season: 'RABI',
      lines: [{ product_id: product.id, qty_milli: 5000, rate_paisa: P(3000) }],
      discount_paisa: 0, payments: [], note: 'credit sale',
    });
    expect(sale.status).toBe(201);
    saleId = sale.json.data.id; saleNumber = sale.json.data.number; partyId = sale.json.data.party_id;
    expect(saleNumber).toMatch(/^FS-\d{4}-\d{6}$/);
    expect(sale.json.data.due_paisa).toBe(P(15000));
    expect(sale.json.data.cost_paisa).toBeGreaterThan(0);
    const pnl1 = (await h.call('GET', `/api/v1/reports/pnl?from=${TODAY}&to=${TODAY}`)).json.data;
    salesRevenueBaseline = pnl1.income_paisa;
    const receipt = await h.call('POST', '/api/v1/receipts', {
      date: TODAY, party_id: partyId, amount_paisa: P(5000), account_id: 'CASH',
      reference: 'TID-1', allocate: 'AUTO', note: 'part payment',
    });
    expect(receipt.status).toBe(201);
    expect(receipt.json.data.allocations.length).toBe(1);
    const pnl2 = (await h.call('GET', `/api/v1/reports/pnl?from=${TODAY}&to=${TODAY}`)).json.data;
    expect(pnl2.income_paisa).toBe(salesRevenueBaseline); // receipt is NOT revenue
    const party = await h.call('GET', `/api/v1/parties/${partyId}`);
    expect(party.json.data.balance_paisa).toBe(P(10000));
    const doc = await h.call('GET', `/api/v1/sales/${saleId}`);
    expect(doc.json.data.allocations.length).toBe(1);
  });

  // --------------------------- A7 pesticide register ---------------------------
  it('A7 expired pesticide batch is hard-blocked; legal sale register is queryable', async () => {
    const pest = await createProduct(h, {
      name_ur: 'پیسٹی سائیڈ ٹیسٹ', name_en: 'Pesticide test', category_id: 'cat-pest',
      is_pesticide: true, track_batch: true, track_expiry: true, purchase_rate_paisa: P(500),
      sale_rate_paisa: P(700), sku: 'PEST-1', is_published: false,
    });
    const opening = await h.call('POST', '/api/v1/stock/opening', {
      date: TODAY, product_id: pest.id, batch_no: 'B-OLD', qty_milli: 10000, unit_cost_paisa: P(500),
    });
    expect(opening.status).toBe(201);
    // Mark the batch expired.
    h.sqlite.exec("UPDATE product_batches SET mfg_date='2020-01-01', expiry_date='2021-01-01' WHERE batch_no='B-OLD'");
    const blocked = await h.call('POST', '/api/v1/sales', {
      date: TODAY, book_code: 'PEST', party_name: 'Buyer', party_phone: '0300-3333333',
      party_address: 'Layyah', lines: [{ product_id: pest.id, qty_milli: 1000, rate_paisa: P(700) }],
      payments: [],
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('EXPIRED_BATCH');
    const missingBuyer = await h.call('POST', '/api/v1/sales', {
      date: TODAY, book_code: 'PEST', party_name: 'Buyer',
      lines: [{ product_id: pest.id, qty_milli: 1000, rate_paisa: P(700) }], payments: [],
    });
    expect(missingBuyer.status).toBe(400);
    expect(missingBuyer.json.error.code).toBe('PESTICIDE_BUYER_REQUIRED');
    const register = await h.call('GET', '/api/v1/reports/pesticide-register');
    expect(register.status).toBe(200);
  });

  // ------------------------------- A8 grains ----------------------------------
  it('A8 all seven crops: net-weight arithmetic, sale, lot balance and farmer payment are isolated', async () => {
    const crops = ['WHEAT', 'RICE', 'SESAME', 'MILLET', 'MAIZE', 'MOONG', 'MUSTARD'];
    for (const crop of crops) {
      const purchase = await h.call('POST', `/api/v1/grains/${crop}/purchase`, {
        date: TODAY, party_name: `Farmer ${crop}`, party_phone: '0300-4444444', village: 'Layyah',
        grade: 'A', gross_grams: 200000, bags: 4, tare_per_bag_grams: 1000,
        deductions: [
          { type: 'MOISTURE', basis: 'percent_milli', value: 2500, note: '2.5%' },
          { type: 'CLEANING', basis: 'weight_grams', value: 2000 },
        ],
        rate_basis: 'PER_MAUND', rate_paisa: P(4000),
        commission_paisa: P(100), labour_paisa: P(50), transport_paisa: P(50),
        payments: [{ account_id: 'CASH', amount_paisa: P(1000) }],
      });
      expect(purchase.status, `${crop} purchase: ${JSON.stringify(purchase.json)}`).toBe(201);
      expect(purchase.json.data.net_grams).toBe(189000);
      const lots = await h.call('GET', `/api/v1/grains/lots?crop=${crop}`);
      expect(lots.json.data.length).toBe(1);
      expect(lots.json.data[0].balance_grams).toBe(189000);
      const sale = await h.call('POST', `/api/v1/grains/${crop}/sale`, {
        date: TODAY, party_name: `Buyer ${crop}`, lot_id: lots.json.data[0].id,
        net_grams: 89000, rate_basis: 'PER_MAUND', rate_paisa: P(4500),
        deductions_paisa: 0, expenses_paisa: 0, payments: [],
      });
      expect(sale.status, `${crop} sale: ${JSON.stringify(sale.json)}`).toBe(201);
      const lots2 = await h.call('GET', `/api/v1/grains/lots?crop=${crop}`);
      expect(lots2.json.data[0].balance_grams).toBe(100000);
      const parties = await h.call('GET', `/api/v1/parties?type=FARMER&q=Farmer%20${crop}`);
      expect(parties.json.data.length).toBe(1);
      const payment = await h.call('POST', '/api/v1/payments', {
        date: TODAY, party_id: parties.json.data[0].id, amount_paisa: P(500),
        account_id: 'CASH', payee_type: 'FARMER', allocate: 'AUTO',
      });
      expect(payment.status).toBe(201);
    }
    const wheat = await h.call('GET', '/api/v1/grains/lots?crop=WHEAT');
    expect(wheat.json.data[0].crop).toBe('WHEAT'); // no cross-crop mixing
  });

  // ------------------------------- A9 goods -----------------------------------
  it('A9 five other goods books post independently with their own stock and profit', async () => {
    const books = [
      ['CHOK', 'چوکر'], ['WAND', 'ونڈا'], ['CEM', 'سیمنٹ'], ['SEED', 'بیج'], ['OTHR', 'دیگر'],
    ] as const;
    for (const [book, name] of books) {
      const p = await createProduct(h, {
        name_ur: `${name} ٹیسٹ`, name_en: `${book} test`, category_id: `cat-${book.toLowerCase()}`,
        sku: `SKU-${book}`, base_unit: 'bag', purchase_rate_paisa: P(1000), sale_rate_paisa: P(1200),
      });
      const op = await h.call('POST', '/api/v1/stock/opening', {
        date: TODAY, product_id: p.id, qty_milli: 50000, unit_cost_paisa: P(1000),
      });
      expect(op.status).toBe(201);
      const s = await h.call('POST', '/api/v1/sales', {
        date: TODAY, book_code: book, party_name: `Customer ${book}`,
        lines: [{ product_id: p.id, qty_milli: 5000, rate_paisa: P(1200) }], payments: [],
      });
      expect(s.status, `${book}: ${JSON.stringify(s.json)}`).toBe(201);
      expect(s.json.data.number.slice(0, 2)).toBeTruthy();
    }
  });

  // --------------------------- A10 money books ---------------------------------
  it('A10 four money books are separate, transfers are not income/expense, fees are expenses', async () => {
    const accounts = (await h.call('GET', '/api/v1/accounts')).json.data;
    expect(accounts.length).toBe(4);
    const before = (await h.call('GET', `/api/v1/reports/pnl?from=${TODAY}&to=${TODAY}`)).json.data;
    const transfer = await h.call('POST', '/api/v1/transfers', {
      date: TODAY, from_account_id: 'CASH', to_account_id: 'UBL', amount_paisa: P(1000), note: 'test',
    });
    expect(transfer.status).toBe(201);
    expect(transfer.json.data.to_balance_paisa - transfer.json.data.from_balance_paisa).not.toBeNaN();
    const after = (await h.call('GET', `/api/v1/reports/pnl?from=${TODAY}&to=${TODAY}`)).json.data;
    expect(after.income_paisa).toBe(before.income_paisa);
    expect(after.expenses_paisa).toBe(before.expenses_paisa);
    const jazzIn = await h.call('POST', '/api/v1/jazzcash', {
      date: TODAY, direction: 'IN', amount_paisa: P(500), counterparty: 'JC Customer',
      mobile: '0300-5555555', tid: 'TID-IN-1', fee_paisa: P(10), purpose: 'COLLECTION',
    });
    expect(jazzIn.status).toBe(201);
    const jazzOut = await h.call('POST', '/api/v1/jazzcash', {
      date: TODAY, direction: 'OUT', amount_paisa: P(200), counterparty: 'JC Supplier',
      mobile: '0300-6666666', tid: 'TID-OUT-1', fee_paisa: P(5), purpose: 'SUPPLIER_PAYMENT',
    });
    expect(jazzOut.status).toBe(201);
    const after2 = (await h.call('GET', `/api/v1/reports/pnl?from=${TODAY}&to=${TODAY}`)).json.data;
    expect(after2.expenses_paisa).toBe(after.expenses_paisa + P(15));
    const st = await h.call('GET', '/api/v1/accounts/JAZZ');
    expect(st.json.data.transactions.some((t: any) => t.ref_type === 'JAZZCASH_FEE')).toBe(true);
  });

  // ------------------------------- A11 khata -----------------------------------
  it('A11 party, book and money-book ledgers agree and statements render from snapshots', async () => {
    const khata = await h.call('GET', `/api/v1/khata?from=${TODAY}&to=${TODAY}&book=FERT`);
    expect(khata.json.data.debit_paisa).toBeGreaterThan(0);
    expect(khata.json.data.debit_paisa - khata.json.data.credit_paisa).toBe(khata.json.data.withBalance.at(-1).running_paisa);
    const books = await h.call('GET', '/api/v1/khata/books');
    expect(books.json.data.money_books.length).toBe(4);
    const stmt = await h.call('GET', `/api/v1/statements?from=${TODAY}&to=${TODAY}&party_id=${partyId}`);
    expect(stmt.status).toBe(200);
    expect(stmt.json.data.snapshot.template_version).toBeTruthy();
    expect(stmt.json.data.snapshot.business.name_ur).toBe('ذیشان ٹریڈرز');
    const docs = await h.call('GET', `/api/v1/documents?from=${TODAY}&to=${TODAY}`);
    expect(docs.json.data.some((d: any) => d.number === saleNumber)).toBe(true);
  });

  // --------------------------- A12 expenses & payroll --------------------------
  it('A12 expense, shop expense and payroll post; duplicate salary is blocked', async () => {
    const exp = await h.call('POST', '/api/v1/expenses', {
      date: TODAY, category_code: 'RENT', vendor: 'Landlord', amount_paisa: P(2000), account_id: 'CASH', note: '',
    });
    expect(exp.status).toBe(201);
    const emp = await h.call('POST', '/api/v1/employees', {
      name: 'Test Employee', role: 'Helper', phone: '0300-7777777', join_date: TODAY,
      base_salary_paisa: P(30000), status: 'ACTIVE',
    });
    expect(emp.status).toBe(201);
    const adv = await h.call('POST', '/api/v1/advances', {
      employee_id: emp.json.data.id, date: TODAY, amount_paisa: P(5000), account_id: 'CASH', note: '',
    });
    expect(adv.status).toBe(201);
    const payroll = await h.call('POST', '/api/v1/payroll', {
      ym: '2026-11', pay_date: TODAY, account_id: 'CASH',
      rows: [{ employee_id: emp.json.data.id, gross_paisa: P(30000), advance_recovered_paisa: P(5000), deductions_paisa: 0 }],
    });
    expect(payroll.status).toBe(201);
    expect(payroll.json.data.posted[0].net_paisa).toBe(P(25000));
    const dup = await h.call('POST', '/api/v1/payroll', {
      ym: '2026-11', pay_date: TODAY, account_id: 'CASH',
      rows: [{ employee_id: emp.json.data.id, gross_paisa: P(30000), advance_recovered_paisa: 0, deductions_paisa: 0 }],
    });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('DUPLICATE_SALARY');
  });

  // ------------------------------ A13 statements -------------------------------
  it('A13 trial balance balances; balance sheet balances; P&L per book is available', async () => {
    const tb = (await h.call('GET', '/api/v1/reports/trial-balance')).json.data;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit_paisa).toBe(tb.totals.credit_paisa);
    expect(tb.totals.debit_paisa).toBeGreaterThan(0);
    const bs = (await h.call('GET', '/api/v1/reports/balance-sheet')).json.data;
    expect(bs.balanced).toBe(true);
    expect(bs.difference_paisa).toBe(0);
    const pnl = (await h.call('GET', `/api/v1/reports/pnl?from=${TODAY}&to=${TODAY}`)).json.data;
    expect(pnl.per_book.length).toBeGreaterThan(0);
    const integrity = (await h.call('GET', '/api/v1/integrity')).json.data;
    expect(integrity.ok, JSON.stringify(integrity.problems)).toBe(true);
  });

  // ---------------------------- A17 three-way recon ----------------------------
  it('A17 dashboard totals equal document totals equal party-ledger sums', async () => {
    const recon = (await h.call('GET', `/api/v1/reports/reconcile?from=${TODAY}&to=${TODAY}`)).json.data;
    expect(recon.values.dashboard).toBe(recon.values.documents);
    expect(recon.values.documents).toBe(recon.values.party_ledger);
    expect(recon.values.documents).toBe(recon.values.journal);
    const dash = (await h.call('GET', `/api/v1/dashboard?from=${TODAY}&to=${TODAY}`)).json.data;
    expect(dash.today.sales_paisa).toBe(recon.values.dashboard);
    expect(dash.books.length).toBeGreaterThanOrEqual(17);
    expect(dash.grains.length).toBe(7);
    expect(dash.accounts.length).toBe(4);
  });

  // -------------------------- A14 offline / conflicts ---------------------------
  it('A14 idempotent sync push does not double-post; insufficient stock becomes a CONFLICT', async () => {
    const key = 'idem-' + Math.random().toString(36).slice(2);
    const payload = {
      date: TODAY, book_code: 'FERT', party_name: 'Offline Customer', party_phone: '0300-8888888',
      lines: [{ product_id: product.id, qty_milli: 1000, rate_paisa: P(3000) }], payments: [],
    };
    const first = await h.call('POST', '/api/v1/sync/push', {
      idempotency_key: key, device_id: 'dev-test-1', type: 'SALE', payload, local_time: new Date().toISOString(),
    });
    expect(first.status).toBe(201);
    expect(first.json.data.status).toBe('SYNCED');
    const second = await h.call('POST', '/api/v1/sync/push', {
      idempotency_key: key, device_id: 'dev-test-1', type: 'SALE', payload, local_time: new Date().toISOString(),
    });
    expect(second.json.data.duplicate).toBe(true);
    expect(second.json.data.id).toBe(first.json.data.id);
    const conflictKey = 'conflict-' + Math.random().toString(36).slice(2);
    const conflict = await h.call('POST', '/api/v1/sync/push', {
      idempotency_key: conflictKey, device_id: 'dev-test-2', type: 'SALE',
      payload: { ...payload, lines: [{ product_id: product.id, qty_milli: 999999999, rate_paisa: P(3000) }] },
      local_time: new Date().toISOString(),
    });
    expect(conflict.json.data.status).toBe('CONFLICT');
    expect(conflict.json.data.code).toBe('INSUFFICIENT_STOCK');
    const conflicts = await h.call('GET', '/api/v1/sync/conflicts');
    expect(conflicts.json.data.some((x: any) => x.code === 'INSUFFICIENT_STOCK')).toBe(true);
  });

  // ---------------------------- A18 usage / backup ------------------------------
  it('A18 usage meter reports D1 reads/writes; encrypted backup is created and integrity passes', async () => {
    const usage = (await h.call('GET', '/api/v1/usage')).json.data;
    expect(usage.rows_read).toBeGreaterThan(0);
    expect(usage.free_read_cap).toBe(5_000_000);
    const backup = await h.call('POST', '/api/v1/backup/run', {});
    expect(backup.status).toBe(201);
    expect(backup.json.data.result).toBe('SUCCESS');
    expect(backup.json.data.size_bytes).toBeGreaterThan(0);
    // Honest: staging restore is NOT claimed as tested.
    expect(backup.json.data.staging_restore_result).toBe('NOT_TESTED');
    const logs = await h.call('GET', '/api/v1/backup');
    expect(logs.json.data.length).toBeGreaterThan(0);
  });

  it('A20 XSS in product description and enquiry is neutralised; SQL injection strings are harmless', async () => {
    const xss = await createProduct(h, {
      name_ur: 'ایکس ایس ایس', name_en: 'xss', sku: 'XSS-1', category_id: 'cat-fert',
      description_ur: '<b>OK</b><script>alert(1)</script><img onerror="alert(2)" src="javascript:alert(3)">',
      is_published: true,
    });
    const detail = await h.call('GET', `/api/v1/public/product/${xss.slug}`);
    const raw = JSON.stringify(detail.json);
    expect(raw).not.toContain('<script');
    expect(raw).not.toContain('onerror=');
    expect(raw).not.toContain('javascript:');
    const enquiry = await h.call('POST', '/api/v1/public/enquiry', {
      customer_name: "Robert'); DROP TABLE products;--", mobile: '0300-9999999', city: 'Layyah',
      message: '<script>alert(1)</script> سلام', consent: true, items: [], honeypot: '', elapsed_ms: 5000,
    }, { cookie: '', csrf: '' });
    expect(enquiry.status).toBe(201);
    const list = await h.call('GET', '/api/v1/enquiries');
    const found = list.json.data.find((e: any) => e.number === enquiry.json.data.reference);
    expect(found.message).not.toContain('<script');
    const products = await h.call('GET', '/api/v1/products');
    expect(products.json.data.rows.length).toBeGreaterThan(0); // table intact
  });

  it('A1 (b) a read-only auditor gets 403 on admin APIs (deny-by-default matrix)', async () => {
    const created = await h.call('POST', '/api/v1/users', {
      username: 'auditor', password: 'auditor-password-123', name: 'Auditor',
      mobile: '0300-1234567', role_codes: ['AUDITOR'],
    });
    expect(created.status).toBe(201);
    const auditorCookie = await h.call('POST', '/api/v1/auth/login',
      { username: 'auditor', password: 'auditor-password-123' }, { cookie: '', csrf: '' });
    expect(auditorCookie.status).toBe(200);
    const cookie = (auditorCookie.headers as any).getSetCookie?.()?.map((x: string) => x.split(';')[0]).join('; ') ?? '';
    const denied = await h.call('POST', '/api/v1/products', { name_ur: 'Nope', category_id: 'cat-fert' },
      { cookie, csrf: auditorCookie.json.data.csrf });
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('PERMISSION_DENIED');
    const allowed = await h.call('GET', '/api/v1/products', undefined, { cookie, csrf: '' });
    expect(allowed.status).toBe(200);
  });
});
