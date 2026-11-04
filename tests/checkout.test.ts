/** Checkout: order capture, payment proofs, admin approval into real postings, and the worker role. */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeHarness, createProduct, type Harness } from './helpers.js';
import { sha256 } from '@zt/shared';

const P = (rupees: number) => Math.round(rupees * 100);
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** Each scenario visits as its own visitor, because checkout is rate-limited per IP. */
const GUEST = (n: number) => ({ cookie: '', csrf: '', ip: `203.0.113.${n}` });

describe('website checkout (real Worker + real SQL)', () => {
  let h: Harness;
  let dap: { id: string };            // FERT book
  let cement: { id: string };         // CEM book
  let methodId = '';

  beforeAll(async () => {
    h = makeHarness();
    await h.setup();
    dap = await createProduct(h, { name_ur: 'ڈی اے پی', name_en: 'DAP', category_id: 'cat-fert',
      public_price_paisa: P(17457), sale_rate_paisa: P(17457), is_published: true });
    cement = await createProduct(h, { name_ur: 'سیمنٹ لاکی', name_en: 'Lucky Cement', category_id: 'cat-cem',
      base_unit: 'bag', public_price_paisa: P(1550), sale_rate_paisa: P(1550), is_published: true });
    await h.call('POST', '/api/v1/stock/opening', { date: '2026-11-01', product_id: cement.id,
      qty_milli: 500_000, unit_cost_paisa: P(1400), reason: 'opening' });
    await h.call('POST', '/api/v1/stock/opening', { date: '2026-11-01', product_id: dap.id,
      qty_milli: 100_000, unit_cost_paisa: P(16000), reason: 'opening' });
  });

  const checkout = (n: number, body: Record<string, unknown>) =>
    h.call('POST', '/api/v1/public/checkout',
      { customer_name: 'گاہک', mobile: '0300-1234567', city: 'ماڑی', payment_method_id: methodId,
        consent: true, elapsed_ms: 4000, ...body }, GUEST(n));

  // ------------------------------- C1 payment methods -------------------------------
  it('C1 admin creates a payment method; cash without a ledger account is refused', async () => {
    const cash = await h.call('POST', '/api/v1/payment-methods', { kind: 'CASH', title_ur: 'دکان نقد' });
    expect(cash.status).toBe(400);
    expect(cash.json.error.code).toBe('ACCOUNT_REQUIRED');

    const created = await h.call('POST', '/api/v1/payment-methods', {
      kind: 'EASYPAISA', title_ur: 'ایزی پیسہ', title_en: 'EasyPaisa',
      mobile_number: '0345-1234567', account_title: 'Zeeshan Traders',
      instructions_ur: 'ارسال کے بعد رسید اپ لوڈ کریں', account_id: 'CASH', is_active: true, sort: 1,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    methodId = created.json.data.id;
    const stored = await h.call('GET', '/api/v1/payment-methods');
    expect(stored.json.data[0].account_id).not.toBe('CASH');   // resolved to the real account id

    const pub = await h.call('GET', '/api/v1/public/payment-methods', undefined, GUEST(90));
    expect(pub.status).toBe(200);
    expect(pub.json.data).toHaveLength(1);
    expect(pub.json.data[0].mobile_number).toBe('0345-1234567');
    // The ledger account an order posts into is internal — never in the public payload.
    expect(pub.json.data[0].account_id).toBeUndefined();
  });

  it('C1b admin uploads the payment QR; it is served back from /media', async () => {
    const qr = await h.call('POST', `/api/v1/payment-methods/${methodId}/qr`, { data_url: PNG_1PX });
    expect(qr.status, JSON.stringify(qr.json)).toBe(201);
    const key = String(qr.json.data.qr_url).replace('/media/', '');
    const res = await h.app.fetch(new Request(`https://zt.test/media/${encodeURIComponent(key)}`), h.env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const listed = await h.call('GET', '/api/v1/public/payment-methods', undefined, GUEST(91));
    expect(listed.json.data[0].qr_url).toBe(qr.json.data.qr_url);
  });

  // --------------------------------- C2 price guards ---------------------------------
  it('C2 an unpublished price blocks checkout instead of inventing one', async () => {
    const unpriced = await createProduct(h, { name_ur: 'ہائبرڈ بیج', category_id: 'cat-seed',
      show_public_price: false, public_price_paisa: 0, is_published: true });
    const res = await checkout(10, { items: [{ product_id: unpriced.id, qty_milli: 1000 }] });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('PRICE_ON_CALL');
  });

  it('C2b bot traps: honeypot drops silently and a fast submit is refused', async () => {
    const hp = await checkout(11, { items: [{ product_id: dap.id, qty_milli: 1000 }], honeypot: 'yes', elapsed_ms: 5000 });
    expect(hp.status).toBe(200);
    expect(hp.json.data.reference).toBe('');

    const fast = await checkout(11, { items: [{ product_id: dap.id, qty_milli: 1000 }], elapsed_ms: 100 });
    expect(fast.status).toBe(400);
    expect(fast.json.error.code).toBe('TIME_TRAP');
  });

  it('C2c checkout is rate-limited per visitor, not globally', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await checkout(50, { items: [{ product_id: cement.id, qty_milli: 1000 }] });
      expect(res.status, `attempt ${i}`).toBe(201);
    }
    const blocked = await checkout(50, { items: [{ product_id: cement.id, qty_milli: 1000 }] });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('RATE_LIMITED');
    const anotherVisitor = await checkout(51, { items: [{ product_id: cement.id, qty_milli: 1000 }] });
    expect(anotherVisitor.status).toBe(201);
  });

  // ------------------------------ C3 order + proof + approve ------------------------------
  it('C3 checkout prices from the catalogue, ignores any client price, and creates no sale', async () => {
    const before = await h.call('GET', '/api/v1/sales');
    const res = await checkout(20, {
      customer_name: 'کاشان احمد', mobile: '0311-7890123', address: 'بہاولپور روڈ',
      notes: 'دو بوری ڈی اے پی اور پانچ سیمنٹ',
      // A hostile client sends its own price — neither field exists in the schema, so it is dropped.
      items: [{ product_id: dap.id, qty_milli: 2000, rate_paisa: 1 }, { product_id: cement.id, qty_milli: 5000, price_paisa: 1 }],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const { reference, token } = res.json.data;
    expect(reference).toMatch(/^OD-\d{4}-\d{6}$/);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(res.json.data.total_paisa).toBe(P(17457) * 2 + P(1550) * 5);

    // Nothing financial happened yet: no sale, no stock movement.
    const after = await h.call('GET', '/api/v1/sales');
    expect(after.json.data.rows.length).toBe(before.json.data.rows.length);
    const list = await h.call('GET', '/api/v1/orders?status=NEW');
    const order = list.json.data.find((o: any) => o.number === reference);
    expect(order.items).toHaveLength(2);

    // Status lookup without the token shows the status but not the proofs.
    const anon = await h.call('GET', `/api/v1/public/order/${reference}`, undefined, GUEST(20));
    expect(anon.json.data.token_ok).toBe(false);
    expect(anon.json.data.proofs).toEqual([]);
    const mine = await h.call('GET', `/api/v1/public/order/${reference}?token=${token}`, undefined, GUEST(20));
    expect(mine.json.data.token_ok).toBe(true);

    // Proof upload needs the token.
    const noToken = await h.call('POST', '/api/v1/public/order/proof', { token: 'x'.repeat(20), data_url: PNG_1PX }, GUEST(20));
    expect(noToken.status).toBe(404);
    const proof = await h.call('POST', '/api/v1/public/order/proof',
      { token, method: 'EasyPaisa', sender_reference: 'TRX-88990', amount_paisa: P(36289), data_url: PNG_1PX, elapsed_ms: 2000 },
      GUEST(20));
    expect(proof.status, JSON.stringify(proof.json)).toBe(201);

    const review = await h.call('GET', '/api/v1/orders?status=UNDER_REVIEW');
    const pending = review.json.data.find((o: any) => o.number === reference);
    expect(pending.proofs[0].sender_reference).toBe('TRX-88990');

    // Approve: one sale per book, money into the method's CASH account, stock moving down.
    const cashBefore = (await h.call('GET', '/api/v1/accounts/CASH')).json.data.balance_paisa;
    const dapQty = (await h.call('GET', '/api/v1/stock')).json.data.find((r: any) => r.id === dap.id).qty_milli;
    const approve = await h.call('POST', `/api/v1/orders/${pending.id}/approve`, { paid: true });
    expect(approve.status, JSON.stringify(approve.json)).toBe(200);
    expect(approve.json.data.sale_ids).toHaveLength(2);   // FS + ES

    const cashAfter = (await h.call('GET', '/api/v1/accounts/CASH')).json.data.balance_paisa;
    expect(cashAfter - cashBefore).toBe(P(17457) * 2 + P(1550) * 5);
    expect((await h.call('GET', '/api/v1/stock')).json.data.find((r: any) => r.id === dap.id).qty_milli)
      .toBe(dapQty - 2000);

    const done = await h.call('GET', `/api/v1/orders/${pending.id}`);
    expect(done.json.data.status).toBe('APPROVED');
    expect(done.json.data.proofs[0].status).toBe('ACCEPTED');

    // Re-approve must not post a second time.
    const again = await h.call('POST', `/api/v1/orders/${pending.id}/approve`, { paid: true });
    expect(again.json.data.already_posted).toBe(true);
    expect((await h.call('GET', '/api/v1/accounts/CASH')).json.data.balance_paisa).toBe(cashAfter);

    // An approved order can no longer be rejected.
    const reject = await h.call('POST', `/api/v1/orders/${pending.id}/reject`, { reason: 'دیر ہو گئی' });
    expect(reject.status).toBe(409);
  });

  it('C3b approval without payment becomes a receivable, not cash', async () => {
    const res = await checkout(21, { customer_name: 'ادمین علی', mobile: '0322-1122334',
      items: [{ product_id: cement.id, qty_milli: 1000 }] });
    expect(res.status).toBe(201);
    const list = await h.call('GET', '/api/v1/orders?status=NEW');
    const order = list.json.data.find((o: any) => o.number === res.json.data.reference);
    const cashBefore = (await h.call('GET', '/api/v1/accounts/CASH')).json.data.balance_paisa;
    const approve = await h.call('POST', `/api/v1/orders/${order.id}/approve`, { paid: false });
    expect(approve.status, JSON.stringify(approve.json)).toBe(200);
    expect((await h.call('GET', '/api/v1/accounts/CASH')).json.data.balance_paisa).toBe(cashBefore);
    const sale = await h.call('GET', `/api/v1/sales/${approve.json.data.sale_ids[0]}`);
    expect(sale.json.data.due_paisa).toBe(P(1550));
    expect(sale.json.data.paid_paisa).toBe(0);
  });

  it('C3c approval is blocked when stock is short, and the order stays reviewable', async () => {
    const res = await checkout(22, { customer_name: 'شاہد', mobile: '0333-5556677',
      items: [{ product_id: dap.id, qty_milli: 900_000 }] });
    expect(res.status).toBe(201);
    const list = await h.call('GET', '/api/v1/orders?status=NEW');
    const order = list.json.data.find((o: any) => o.number === res.json.data.reference);
    const approve = await h.call('POST', `/api/v1/orders/${order.id}/approve`, { paid: true });
    expect(approve.status).toBe(409);
    expect(approve.json.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await h.call('GET', `/api/v1/orders/${order.id}`)).json.data.status).toBe('NEW');
  });

  it('C3d rejection needs a reason and freezes the order', async () => {
    const res = await checkout(23, { customer_name: 'وقار', mobile: '0300-9988776',
      items: [{ product_id: cement.id, qty_milli: 1000 }] });
    expect(res.status).toBe(201);
    const list = await h.call('GET', '/api/v1/orders?status=NEW');
    const order = list.json.data.find((o: any) => o.number === res.json.data.reference);
    const bad = await h.call('POST', `/api/v1/orders/${order.id}/reject`, { reason: 'x' });
    expect(bad.status).toBe(400);
    const no = await h.call('POST', `/api/v1/orders/${order.id}/reject`, { reason: 'اسٹاک ختم' });
    expect(no.json.data.status).toBe('REJECTED');
    // A rejected order cannot take another proof.
    const proof = await h.call('POST', '/api/v1/public/order/proof',
      { token: res.json.data.token, data_url: PNG_1PX, elapsed_ms: 2000 }, GUEST(23));
    expect(proof.status).toBe(409);
    expect(proof.json.error.code).toBe('ORDER_CLOSED');
  });

  // -------------------------------- C4 token handling ---------------------------------
  it('C4 the access token is stored hashed, so a leaked row cannot be replayed', async () => {
    const res = await checkout(24, { customer_name: 'عبدالحمید', mobile: '0344-1231234',
      items: [{ product_id: cement.id, qty_milli: 1000 }] });
    expect(res.status).toBe(201);
    const row = h.sqlite.prepare('SELECT access_token_hash FROM orders WHERE number=?')
      .get(res.json.data.reference) as { access_token_hash: string };
    expect(row.access_token_hash).not.toContain(res.json.data.token);
    expect(row.access_token_hash).toBe(await sha256(res.json.data.token));
  });

  // ---------------------------------- C5 worker role ----------------------------------
  it('C5 a worker user can raise an invoice but cannot approve orders or edit payment methods', async () => {
    const created = await h.call('POST', '/api/v1/users', {
      username: 'worker-1', password: 'worker-password-123', name: 'ورکر', mobile: '0300-4445556',
      role_codes: ['WORKER'],
    });
    expect(created.status).toBe(201);
    const login = await h.call('POST', '/api/v1/auth/login',
      { username: 'worker-1', password: 'worker-password-123' }, { cookie: '', csrf: '' });
    expect(login.status).toBe(200);
    const cookie = (login.headers as any).getSetCookie?.()?.map((x: string) => x.split(';')[0]).join('; ') ?? '';
    const csrf = login.json.data.csrf;

    const perms = (await h.call('GET', '/api/v1/auth/me', undefined, { cookie, csrf })).json.data.user.permissions;
    expect(perms).toContain('sales.post');
    expect(perms).not.toContain('orders.review');
    expect(perms).not.toContain('payments.methods.write');
    expect(perms).not.toContain('users.write');

    const invoice = await h.call('POST', '/api/v1/sales', {
      date: '2026-11-02', book_code: 'CEM', party_name: 'گاہک از ورکر', party_phone: '0300-7778889',
      party_address: 'ماڑی', lines: [{ product_id: cement.id, qty_milli: 1000, rate_paisa: P(1550) }],
      discount_paisa: 0, payments: [], note: 'counter sale',
    }, { cookie, csrf });
    expect(invoice.status, JSON.stringify(invoice.json)).toBe(201);

    const deniedApprove = await h.call('POST', '/api/v1/orders/whatever/approve', { paid: true }, { cookie, csrf });
    expect(deniedApprove.status).toBe(403);
    expect(deniedApprove.json.error.code).toBe('PERMISSION_DENIED');
    const deniedQr = await h.call('POST', `/api/v1/payment-methods/${methodId}/qr`, { data_url: PNG_1PX }, { cookie, csrf });
    expect(deniedQr.status).toBe(403);
    const deniedProductWrite = await h.call('POST', '/api/v1/products', { name_ur: 'Nope', category_id: 'cat-cem' }, { cookie, csrf });
    expect(deniedProductWrite.status).toBe(403);
    const canSeeOrders = await h.call('GET', '/api/v1/orders', undefined, { cookie, csrf });
    expect(canSeeOrders.status).toBe(200);
  });

  it('C6 a method with orders is deactivated rather than deleted', async () => {
    const list = await h.call('GET', '/api/v1/orders');
    expect(list.json.data.length).toBeGreaterThan(0);
    const del = await h.call('DELETE', `/api/v1/payment-methods/${methodId}`);
    expect(del.json.data.deactivated).toBe(true);
    const pub = await h.call('GET', '/api/v1/public/payment-methods', undefined, GUEST(92));
    expect(pub.json.data).toHaveLength(0);
  });
});
