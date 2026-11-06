/**
 * Website checkout: order capture, payment proofs, admin review, and the bridge into the
 * existing posting engines. An order is a request — stock, ledger and journal only move when
 * an admin approves it, and approval goes through postSale() exactly like the ERP does.
 */
import type { Hono } from 'hono';
import type { AppEnv, AppVars } from '../context.js';
import {
  ok, fail, handle, me, audit, nowIso, today, requirePerm, BizError,
  rateLimit, clientIp, verifyTurnstile, setSetting, assertRowVersion,
} from '../context.js';
import {
  checkoutSchema, paymentMethodSchema, proofSchema, orderDecisionSchema, orderRejectSchema,
  lineAmount, sumPaisa, ulid, randomToken, sha256, seqNumber,
} from '@zt/shared';
import { postSale } from '../services/trade.js';
import { decodeDataUrl, putMedia } from '../services/media.js';
import type { DB } from '../db.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

const PROOF_TYPES = ['webp', 'jpeg', 'jpg', 'png'];
const QR_TYPES = ['webp', 'jpeg', 'jpg', 'png', 'avif'];

/** Never leaks a hashed token, an access token, or internal ids the customer has no use for. */
function publicOrderView(row: any, items: any[] = [], proofs: any[] = []) {
  return {
    number: row.number, status: row.status,
    customer_name: row.customer_name, mobile: row.mobile, city: row.city,
    total_paisa: row.total_paisa, ordered_at: row.ordered_at,
    payment_method: row.payment_method_snapshot,
    reject_reason: row.status === 'REJECTED' ? row.reject_reason : '',
    items: items.map((i) => ({
      name_ur: i.name_ur, unit: i.unit, qty_milli: i.qty_milli,
      rate_paisa: i.rate_paisa, line_total_paisa: i.line_total_paisa,
    })),
    proofs: proofs.map((p) => ({
      id: p.id, method: p.method, amount_paisa: p.amount_paisa, status: p.status,
      uploaded_at: p.uploaded_at, url: p.media_key ? `/media/${p.media_key}` : '',
    })),
  };
}

async function loadOrder(db: DB, id: string) {
  const row = await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<any>();
  if (!row) throw new BizError(404, 'ORDER_NOT_FOUND', 'آرڈر نہیں ملا', 'Order not found');
  const items = await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY name_ur').bind(id).all<any>();
  const proofs = await db.prepare('SELECT * FROM payment_proofs WHERE order_id=? ORDER BY uploaded_at').bind(id).all<any>();
  return { row, items, proofs };
}

/** Money books are addressed by id or code ('CASH', 'MEEZAN'); always store the resolved id. */
async function normalizeAccount(db: DB, ref?: string | null): Promise<string | null> {
  if (!ref || !ref.trim()) return null;
  const val = ref.trim();
  const row = await db.prepare('SELECT id FROM financial_accounts WHERE (id=? OR code=?) AND is_active=1')
    .bind(val, val).first<{ id: string }>();
  if (!row) throw new BizError(400, 'ACCOUNT_NOT_FOUND', 'کھاتہ نہیں ملا', `Ledger account not found: ${ref}`);
  return row.id;
}

export function registerCheckout(app: H) {
  // ----------------------------- Public: payment methods -----------------------------
  app.get('/api/v1/public/payment-methods', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT id,kind,title_ur,title_en,bank_name,account_title,account_number,
      iban,mobile_number,instructions_ur,qr_key,sort FROM payment_methods
      WHERE is_active=1 ORDER BY sort,title_ur`).all<any>();
    return ok(c, rows.map((r) => ({ ...r, qr_url: r.qr_key ? `/media/${r.qr_key}` : '' })));
  }));

  // --------------------------------- Public: checkout ---------------------------------
  app.post('/api/v1/public/checkout', (c) => handle(c, async () => {
    const db = c.get('db')!;
    if (!(await rateLimit(db, `checkout:${clientIp(c)}`, 6, 60 * 60_000))) {
      throw new BizError(429, 'RATE_LIMITED', 'بہت زیادہ آرڈر', 'Too many orders from this device');
    }
    const raw = await c.req.json();
    if (raw.honeypot) return ok(c, { reference: '' });                     // silently drop bots
    if (Number(raw.elapsed_ms) < 1500) {
      return fail(c, 400, 'TIME_TRAP', 'براہِ کرم فارم دوبارہ بھیجیں', 'Please submit the form again');
    }
    if (c.env.TURNSTILE_SECRET && !(await verifyTurnstile(c, String(raw.turnstile_token ?? '')))) {
      return fail(c, 403, 'TURNSTILE_FAILED', 'بوٹ کی تصدیق ناکام', 'Anti-bot verification failed');
    }
    const body = checkoutSchema.parse(raw);

    let method = await db.prepare('SELECT * FROM payment_methods WHERE id=? AND is_active=1 AND deleted=0')
      .bind(body.payment_method_id).first<any>();
    if (!method) {
      method = await db.prepare('SELECT * FROM payment_methods WHERE is_active=1 AND deleted=0 ORDER BY sort LIMIT 1').first<any>();
    }
    if (!method) {
      const at = nowIso();
      const defMethodId = ulid();
      await db.prepare(`INSERT INTO payment_methods (id,kind,title_ur,title_en,bank_name,account_title,account_number,iban,mobile_number,instructions_ur,qr_key,sort,is_active,is_system,created_at,updated_at,version,deleted)
        VALUES (?,'CASH','کیش آن ڈیلیوری','Cash on Delivery','Cash','Default','','','','سامان پہنچنے پر رقم ادا کریں۔','',0,1,1,?,?,1,0)`).bind(defMethodId, at, at).run();
      method = { id: defMethodId, title_ur: 'کیش آن ڈیلیوری', title_en: 'Cash on Delivery', kind: 'CASH' };
    }

    // Prices come from the catalogue only — a client-sent price is never read.
    const priced: { product: any; qty_milli: number; rate_paisa: number; line_total_paisa: number }[] = [];
    for (const line of body.items) {
      const p = await db.prepare(`SELECT id,name_ur,base_unit,is_published,is_active,show_public_price,
        public_price_paisa,sale_rate_paisa,availability_mode FROM products WHERE id=? AND deleted=0`).bind(line.product_id).first<any>();
      if (!p || !p.is_published || !p.is_active) {
        throw new BizError(409, 'PRODUCT_UNAVAILABLE', 'منتخب مصنوعات اب دستیاب نہیں', 'A selected product is no longer available');
      }
      const isPublicPrice = Boolean(p.show_public_price);
      const rate = Number(p.public_price_paisa) || (isPublicPrice ? Number(p.sale_rate_paisa) : 0);
      if (!isPublicPrice || !rate) {
        throw new BizError(409, 'PRICE_ON_CALL', `${p.name_ur}: قیمت فون پر پوچھیں، آن لائن آرڈر ممکن نہیں`,
          `${p.name_ur} has no published price — order it by phone or enquiry`);
      }
      priced.push({ product: p, qty_milli: line.qty_milli, rate_paisa: rate, line_total_paisa: lineAmount(line.qty_milli, rate) });
    }
    if (priced.length === 0) {
      throw new BizError(400, 'EMPTY_ORDER', 'کم از کم ایک دستیاب پروڈکٹ منتخب کریں', 'Please select at least one available product');
    }
    const total = sumPaisa(priced.map((l) => l.line_total_paisa));
    if (total <= 0) {
      throw new BizError(400, 'EMPTY_ORDER', 'آرڈر خالی ہے', 'Order has no value');
    }

    const seq = await db.prepare('SELECT prefix,next_value FROM invoice_sequences WHERE code=?').bind('ORDER').first<any>();
    const number = seqNumber(seq?.prefix ?? 'OD', seq?.next_value ?? 1);
    const id = ulid();
    const at = nowIso();
    const token = randomToken(24);
    const stmts: any[] = [
      db.prepare('UPDATE invoice_sequences SET next_value=next_value+1,updated_at=? WHERE code=?').bind(at, 'ORDER'),
      db.prepare(`INSERT INTO orders (id,number,access_token_hash,customer_name,mobile,city,address,notes,
        payment_method_id,payment_method_snapshot,total_paisa,status,ordered_at,updated_at,version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'NEW',?,?,1)`)
        .bind(id, number, await sha256(token), body.customer_name, body.mobile, body.city, body.address,
          body.notes, method.id, method.title_ur, total, at, at),
    ];
    for (const l of priced) {
      stmts.push(db.prepare(`INSERT INTO order_items (id,order_id,product_id,name_ur,unit,qty_milli,rate_paisa,line_total_paisa)
        VALUES (?,?,?,?,?,?,?,?)`)
        .bind(ulid(), id, l.product.id, l.product.name_ur, l.product.base_unit, l.qty_milli, l.rate_paisa, l.line_total_paisa));
    }
    stmts.push(db.prepare(`INSERT INTO notifications (id,user_id,type,title_ur,body_ur,created_at,read_at)
      VALUES (?,NULL,'ORDER',?,?,?,NULL)`).bind(ulid(), 'نیا آن لائن آرڈر', `${body.customer_name} — ${number} — Rs ${(total / 100).toFixed(0)}`, at));
    await db.batch(stmts);
    // One-time secret: shown once, stored only as a hash, and the only way to edit this order.
    return ok(c, { reference: number, token, total_paisa: total }, 201);
  }));

  // ------------------------- Public: order status + payment proof ------------------------
  app.get('/api/v1/public/order/:number', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare('SELECT * FROM orders WHERE number=?').bind(c.req.param('number')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'آرڈر نہیں ملا', 'Order not found');
    const supplied = c.req.query('token') ?? '';
    const mine = supplied.length >= 16 && (await sha256(supplied)) === row.access_token_hash;
    const proofs = mine
      ? await db.prepare('SELECT * FROM payment_proofs WHERE order_id=? ORDER BY uploaded_at').bind(row.id).all<any>()
      : [];
    // Without the token the status is still checkable, but no proof detail is disclosed.
    return ok(c, { ...publicOrderView({ ...row, access_token_hash: undefined }, [], proofs), token_ok: mine });
  }));

  app.post('/api/v1/public/order/proof', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const body = proofSchema.parse(await c.req.json());
    const row = await db.prepare('SELECT * FROM orders WHERE access_token_hash=?').bind(await sha256(body.token)).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'آرڈر نہیں ملا', 'Order not found');
    if (row.status === 'APPROVED' || row.status === 'REJECTED' || row.status === 'CANCELLED') {
      throw new BizError(409, 'ORDER_CLOSED', `آرڈر ${row.number} پہلے ہی ${row.status} ہے`, `Order is already ${row.status}`);
    }
    const count = await db.prepare('SELECT COUNT(*) n FROM payment_proofs WHERE order_id=?').bind(row.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= 6) throw new BizError(429, 'TOO_MANY_PROOFS', 'بہت زیادہ رسیدیں', 'Too many payment proofs');

    const { bytes, ext } = decodeDataUrl(body.data_url, PROOF_TYPES);
    const key = `proofs/${row.id}/${ulid()}.${ext}`;
    await putMedia(c, key, bytes);
    const id = ulid(); const at = nowIso();
    await db.batch([
      db.prepare(`INSERT INTO payment_proofs (id,order_id,method,sender_reference,amount_paisa,uploaded_at,mime,size_bytes,media_key,status)
        VALUES (?,?,?,?,?,?,?,?,?,'NEW')`)
        .bind(id, row.id, body.method, body.sender_reference, body.amount_paisa || row.total_paisa,
          at, `image/${ext}`, bytes.length, key),
      db.prepare("UPDATE orders SET status='UNDER_REVIEW',updated_at=?,version=version+1 WHERE id=? AND status='NEW'").bind(at, row.id),
    ]);
    return ok(c, { id, url: `/media/${key}`, order_status: 'UNDER_REVIEW' }, 201);
  }));

  // --------------------------------- Admin: orders ---------------------------------
  app.get('/api/v1/orders', requirePerm('orders.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const status = c.req.query('status') ?? '';
    const where = status ? 'WHERE status=?' : '';
    const args = status ? [status] : [];
    const rows = await db.prepare(`SELECT * FROM orders ${where} ORDER BY ordered_at DESC LIMIT 200`).bind(...args).all<any>();
    const items = await db.prepare('SELECT * FROM order_items LIMIT 2000').all<any>();
    const proofs = await db.prepare('SELECT id,order_id,method,sender_reference,amount_paisa,uploaded_at,size_bytes,media_key,status FROM payment_proofs LIMIT 2000').all<any>();
    return ok(c, rows.map((r) => ({
      ...publicOrderView(r, items.filter((i) => i.order_id === r.id), proofs.filter((p) => p.order_id === r.id)),
      id: r.id, address: r.address, notes: r.notes, party_id: r.party_id,
      sale_ids: JSON.parse(r.sale_ids || '[]') as string[],
      reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by,
      proofs: proofs.filter((p) => p.order_id === r.id).map((p) => ({
        ...p, url: p.media_key ? `/media/${p.media_key}` : '',
      })),
    })));
  }));

  app.get('/api/v1/orders/:id', requirePerm('orders.read'), (c) => handle(c, async () => {
    const { row, items, proofs } = await loadOrder(c.get('db')!, c.req.param('id'));
    return ok(c, publicOrderView(row, items, proofs));
  }));

  /** Approve = post a real sale per book, optionally collected into the method's ledger account. */
  app.post('/api/v1/orders/:id/approve', requirePerm('orders.review'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const decision = orderDecisionSchema.parse(await c.req.json());
    const { row, items, proofs } = await loadOrder(db, c.req.param('id'));
    if (row.status === 'APPROVED') return ok(c, { id: row.id, number: row.number, already_posted: true,
      sale_ids: JSON.parse(row.sale_ids || '[]') });
    if (row.status === 'REJECTED' || row.status === 'CANCELLED') {
      throw new BizError(409, 'ORDER_CLOSED', 'مسترد شدہ آرڈر منظور نہیں ہو سکتا', 'A rejected order cannot be approved');
    }
    if (!items.length) throw new BizError(409, 'EMPTY_ORDER', 'آرڈر میں لائنیں نہیں', 'Order has no lines');

    let account_id: string | null = null;
    if (decision.paid) {
      const method = await db.prepare('SELECT account_id,title_ur FROM payment_methods WHERE id=?')
        .bind(row.payment_method_id).first<any>();
      account_id = method?.account_id ?? null;
      if (!account_id) {
        throw new BizError(409, 'NO_LEDGER_ACCOUNT',
          `${method?.title_ur ?? 'یہ طریقہ'} سے کوئی کھاتہ جڑا نہیں — پہلے ادائیگی کے طریقے میں کھاتہ منتخب کریں`,
          'Link a financial account on this payment method before marking the order paid');
      }
    }

    // One sale per book, because the posting engine keeps a single book per document.
    const byBook = new Map<string, any[]>();
    for (const item of items) {
      const p = await db.prepare('SELECT p.id,p.sku,p.track_batch,p.is_pesticide,c.book_code FROM products p JOIN product_categories c ON c.id=p.category_id WHERE p.id=?')
        .bind(item.product_id).first<any>();
      if (!p) throw new BizError(409, 'PRODUCT_UNAVAILABLE', `${item.name_ur}: اب کیٹلاگ میں نہیں`, `${item.name_ur} left the catalogue`);
      if (p.is_pesticide && (!row.mobile || !row.address)) {
        throw new BizError(409, 'PESTICIDE_BUYER_REQUIRED', 'کیڑے مار ادویات کے آرڈر میں پتہ لازمی ہے', 'Pesticide order needs a delivery address');
      }
      const book = p.book_code || 'OTHR';
      byBook.set(book, [...(byBook.get(book) ?? []), item]);
    }

    const saleIds: string[] = [];
    const numbers: string[] = [];
    let party_id = row.party_id;
    const date = today();
    for (const [book, lines] of byBook) {
      const result = await postSale(c, {
        date, book_code: book,
        party_id: party_id ?? undefined, party_name: row.customer_name, party_phone: row.mobile,
        party_address: row.address, season: 'NONE',
        lines: lines.map((l) => ({ product_id: l.product_id, qty_milli: l.qty_milli, rate_paisa: l.rate_paisa, discount_paisa: 0 })),
        discount_paisa: 0, freight_paisa: 0, loading_paisa: 0, other_paisa: 0,
        payments: account_id
          ? [{ account_id, amount_paisa: sumPaisa(lines.map((l) => l.line_total_paisa)) }]
          : [],
        note: `آن لائن آرڈر ${row.number}${decision.note ? ` — ${decision.note}` : ''}`,
        idempotency_key: `ORD:${row.id}:${book}`,
        offline: false, quick: false, status: 'POSTED',
      } as any);
      party_id = party_id ?? (result as any).party_id ?? null;
      saleIds.push(result.id);
      numbers.push(result.number);
    }

    const at = nowIso();
    const stmts: any[] = [
      db.prepare(`UPDATE orders SET status='APPROVED',party_id=?,sale_ids=?,reviewed_at=?,reviewed_by=?,
        updated_at=?,version=version+1 WHERE id=? AND status<>'APPROVED'`)
        .bind(party_id, JSON.stringify(saleIds), at, me(c).id, at, row.id),
    ];
    if (decision.mark_proof_accepted) {
      stmts.push(db.prepare("UPDATE payment_proofs SET status='ACCEPTED' WHERE order_id=? AND status='NEW'").bind(row.id));
    }
    await db.batch(stmts);
    await audit(db, 'APPROVE', 'orders', row.id, {
      user_id: me(c).id, after: { sale_ids: saleIds, paid: decision.paid, account_id, proofs: proofs.length },
    });
    return ok(c, { id: row.id, number: row.number, sale_ids: saleIds, sale_numbers: numbers,
      invoice_url: saleIds.length ? `/erp/sales/${saleIds[0]}` : '', paid: decision.paid });
  }));

  app.post('/api/v1/orders/:id/reject', requirePerm('orders.review'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const body = orderRejectSchema.parse(await c.req.json());
    const { row } = await loadOrder(db, c.req.param('id'));
    if (row.status === 'APPROVED') throw new BizError(409, 'ALREADY_POSTED', 'منظور شدہ آرڈر مسترد نہیں؛ فروخت میں کریڈٹ نوٹ بنائیں', 'Approved orders are reversed on the sale, not here');
    const at = nowIso();
    await db.batch([
      db.prepare(`UPDATE orders SET status='REJECTED',reject_reason=?,reviewed_at=?,reviewed_by=?,updated_at=?,version=version+1
        WHERE id=? AND status<>'APPROVED'`).bind(body.reason, at, me(c).id, at, row.id),
      db.prepare("UPDATE payment_proofs SET status='REJECTED' WHERE order_id=? AND status='NEW'").bind(row.id),
    ]);
    await audit(db, 'REJECT', 'orders', row.id, { user_id: me(c).id, after: { reason: body.reason } });
    return ok(c, { id: row.id, status: 'REJECTED' });
  }));

  app.post('/api/v1/orders/:id/proofs/:pid/status', requirePerm('orders.review'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const body = await c.req.json() as { status?: string };
    if (!['ACCEPTED', 'REJECTED', 'NEW'].includes(String(body.status))) {
      throw new BizError(400, 'INVALID_STATUS', 'غلط حالت', 'Invalid proof status');
    }
    const res = await db.prepare('UPDATE payment_proofs SET status=? WHERE id=? AND order_id=?')
      .bind(body.status, c.req.param('pid'), c.req.param('id')).run();
    if (!res.changes) return fail(c, 404, 'NOT_FOUND', 'رسید نہیں ملی', 'Proof not found');
    return ok(c, { id: c.req.param('pid'), status: body.status });
  }));

  // ----------------------------- Admin: payment methods -----------------------------
  app.get('/api/v1/payment-methods', requirePerm('orders.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare('SELECT * FROM payment_methods WHERE deleted=0 ORDER BY sort,title_ur').all<any>();
    return ok(c, rows.map((r) => ({ ...r, is_active: !!r.is_active, qr_url: r.qr_key ? `/media/${r.qr_key}` : '' })));
  }));

  app.post('/api/v1/payment-methods', requirePerm('payments.methods.write'), (c) => handle(c, async () => {
    const body = paymentMethodSchema.parse(await c.req.json());
    const db = c.get('db')!;
    const account_id = await normalizeAccount(db, body.account_id);
    if (body.kind === 'CASH' && !account_id) {
      throw new BizError(400, 'ACCOUNT_REQUIRED', 'نقد کے لیے کھاتہ لازمی ہے', 'Cash needs a ledger account so money lands somewhere');
    }
    const id = ulid(); const at = nowIso();
    await db.prepare(`INSERT INTO payment_methods (id,kind,title_ur,title_en,bank_name,account_title,account_number,iban,
      mobile_number,instructions_ur,qr_key,account_id,is_active,sort,created_at,updated_at,updated_by,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?,?,1)`)
      .bind(id, body.kind, body.title_ur, body.title_en, body.bank_name, body.account_title, body.account_number,
        body.iban, body.mobile_number, body.instructions_ur, account_id,
        body.is_active ? 1 : 0, body.sort, at, at, me(c).id).run();
    await audit(db, 'CREATE', 'payment_methods', id, { user_id: me(c).id, after: { ...body, account_id } });
    return ok(c, { id }, 201);
  }));

  app.put('/api/v1/payment-methods/:id', requirePerm('payments.methods.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const raw = await c.req.json();
    const body = paymentMethodSchema.parse(raw);
    const before = await assertRowVersion(db, 'payment_methods', 'id', c.req.param('id'), (raw as any)?.base_version);
    if (!before) return fail(c, 404, 'NOT_FOUND', 'طریقہ نہیں ملا', 'Payment method not found');
    const at = nowIso();
    const r = await db.prepare(`UPDATE payment_methods SET kind=?,title_ur=?,title_en=?,bank_name=?,account_title=?,account_number=?,
      iban=?,mobile_number=?,instructions_ur=?,account_id=?,is_active=?,sort=?,updated_at=?,updated_by=?,version=version+1
      WHERE id=? AND version=?`)
      .bind(body.kind, body.title_ur, body.title_en, body.bank_name, body.account_title, body.account_number,
        body.iban, body.mobile_number, body.instructions_ur, await normalizeAccount(db, body.account_id),
        body.is_active ? 1 : 0, body.sort, at, me(c).id, before.id, before.version).run();
    if (r.changes !== 1) {
      const current = await db.prepare('SELECT * FROM payment_methods WHERE id=?').bind(before.id).first<any>();
      throw new BizError(409, 'VERSION_CONFLICT',
        'کسی اور نے بھی یہ طریقہ تبدیل کیا ہے — دوبارہ لوڈ کریں',
        'This payment method changed elsewhere — reload', undefined, current ?? before);
    }
    await audit(db, 'UPDATE', 'payment_methods', before.id, { user_id: me(c).id, before, after: body });
    return ok(c, { id: before.id, version: before.version + 1 });
  }));

  app.delete('/api/v1/payment-methods/:id', requirePerm('payments.methods.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const id = c.req.param('id');
    const before = await assertRowVersion(db, 'payment_methods', 'id', id, c.req.query('base_version'));
    if (!before) return fail(c, 404, 'NOT_FOUND', 'طریقہ نہیں ملا', 'Payment method not found');
    const used = await db.prepare('SELECT COUNT(*) n FROM orders WHERE payment_method_id=?').bind(id).first<{ n: number }>();
    if ((used?.n ?? 0) > 0) {
      // Historical orders snapshot the title, but the FK must keep pointing at a real row.
      await db.prepare('UPDATE payment_methods SET is_active=0,updated_at=?,version=version+1 WHERE id=?')
        .bind(nowIso(), id).run();
      return ok(c, { id, deactivated: true });
    }
    // Soft delete, never a hard one: every other device learns about the removal from the
    // tombstone that /api/v1/sync/pull keeps returning. A DELETE would vanish from the delta and
    // leave the row alive forever on the offline PCs.
    await db.prepare('UPDATE payment_methods SET deleted=1,is_active=0,updated_at=?,version=version+1 WHERE id=?')
      .bind(nowIso(), id).run();
    await audit(db, 'DELETE', 'payment_methods', id, { user_id: me(c).id });
    return ok(c, { id, deleted: true });
  }));

  app.post('/api/v1/payment-methods/:id/qr', requirePerm('payments.methods.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const method = await db.prepare('SELECT * FROM payment_methods WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!method) return fail(c, 404, 'NOT_FOUND', 'طریقہ نہیں ملا', 'Payment method not found');
    const body = await c.req.json() as { data_url?: string };
    const { bytes, ext } = decodeDataUrl(String(body.data_url ?? ''), QR_TYPES);
    const key = `payment-qr/${method.id}/current.${ext}`;
    await putMedia(c, key, bytes);
    const at = nowIso();
    await db.prepare('UPDATE payment_methods SET qr_key=?,updated_at=?,version=version+1 WHERE id=?').bind(key, at, method.id).run();
    await audit(db, 'QR_UPLOAD', 'payment_methods', method.id, { user_id: me(c).id, after: { key, size_bytes: bytes.length } });
    return ok(c, { id: method.id, qr_url: `/media/${key}` }, 201);
  }));

  // ------------------------------- Logo upload ---------------------------------------
  // The ERP settings screen needs the same storage path as QR codes when R2 is absent.
  app.post('/api/v1/settings/logo', requirePerm('settings.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const body = await c.req.json() as { data_url?: string };
    const { bytes, ext } = decodeDataUrl(String(body.data_url ?? ''), QR_TYPES);
    const key = `branding/logo.${ext}`;
    await putMedia(c, key, bytes);
    await setSetting(db, 'logo_r2_key', key, me(c).id);
    return ok(c, { url: `/media/${key}` }, 201);
  }));

  app.get('/api/v1/orders-meta/checkout-ready', requirePerm('orders.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const methods = await db.prepare('SELECT COUNT(*) n FROM payment_methods WHERE is_active=1').first<{ n: number }>();
    const priced = await db.prepare('SELECT COUNT(*) n FROM products WHERE deleted=0 AND is_published=1 AND is_active=1 AND show_public_price=1 AND public_price_paisa>0').first<{ n: number }>();
    const pending = await db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('NEW','UNDER_REVIEW')").first<{ n: number }>();
    return ok(c, {
      payment_methods: methods?.n ?? 0,
      priced_products: priced?.n ?? 0,
      pending_orders: pending?.n ?? 0,
      media_backend: c.env.FILES ? 'r2' : 'd1',
    });
  }));
}
