/**
 * The desktop's stand-in for the API: every call the mirror can answer honestly, answered from local
 * SQLite in exactly the shape the worker's own handler would have returned.
 *
 * Why the shapes must match key for key: the ERP screens were written against the server's JSON
 * (`{rows, next_cursor}` here, a bare array there, `{key: value}` for settings). If the desktop invented
 * its own envelope, every screen would need a desktop branch, and the point of one data-access layer
 * would be gone. So the SELECTs below are copied from apps/worker/src/routes/ — deliberately, visibly,
 * and each one says which handler it copies. They run against two databases, not against two codebases.
 *
 * Pure Node: no `electron` import anywhere, so the whole file runs in CI with an in-memory store and a
 * fake transport.
 */
'use strict';

const restMap = require('./rest-map.cjs');
const registry = require('./registry.cjs');
const { ulid } = require('./db.cjs');

const CODE = {
  OFFLINE: ['OFFLINE_UNAVAILABLE', 'یہ ڈیٹا آف لائن دستیاب نہیں — آن لائن دوبارہ کوشش کریں',
    'This view needs a connection. Your records and bills are still saved offline.'],
  NOT_FOUND: ['NOT_FOUND', 'رکارڈ نہیں ملا', 'Record not found'],
  BAD_REQUEST: ['BAD_REQUEST', 'درخواست غلط ہے', 'Bad request'],
  STALE: ['STALE_LOCAL', 'یہ ریکارڈ اس مشین پر بدل چکا ہے — دوبارہ لوڈ کریں',
    'This record changed on this machine; reload it before saving'],
};

const envelope = (data, status = 200) => ({ ok: true, status, data });
function failure(status, [code, message_ur, message_en], extra) {
  return { ok: false, status, error: { code, message_ur, message_en, ...(extra ? { details: extra } : {}) } };
}
const fail = (status, key, extra) => failure(status, CODE[key], extra);

/** A query string is all strings; SQL wants numbers where the column holds one. */
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const like = (v) => `%${String(v).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function createRestServe({ store, log = () => {}, http }) {
  const db = store.db;
  /** A read the mirror cannot serve: hand it to the transport, or say the line is down. */
  const fallback = (reason) => ({ local: false, reason });

  // ============================================================ local reads ====
  // Each reader returns `null` when the mirror cannot answer (a missing table, a half-migrated schema),
  // which the caller turns into a forward or an honest 503. An exception is never a blank screen.

  const sql = (text, ...args) => db.prepare(text).all(...args);
  const sqlOne = (text, ...args) => db.prepare(text).get(...args) ?? null;

  /** catalogue.ts:225 — the ERP's product grid: joined names, summed stock, keyset paging. */
  function readProducts(query) {
    if (!store.hasTable('products') || !store.hasTable('stock_balance')) return null;
    const where = ['p.deleted=0'];
    const args = [];
    const q = String(query.q ?? '').trim();
    if (q) { where.push('(p.name_ur LIKE ? OR p.name_en LIKE ? OR p.sku LIKE ?)'); args.push(like(q), like(q), like(q)); }
    if (query.category) { where.push('p.category_id=?'); args.push(String(query.category)); }
    if (query.brand) { where.push('p.brand_id=?'); args.push(String(query.brand)); }
    if (query.active === '0') where.push('p.is_active=0');
    if (query.published === '1') where.push('p.is_published=1');
    if (query.low_stock === '1') where.push('p.reorder_level_milli > 0');
    const limit = Math.min(200, Math.max(1, num(query.limit) ?? 25));
    // (created_at,id) — the same keyset the server pages by, so "load more" means the same thing here.
    const cursor = String(query.cursor ?? '');
    if (cursor.includes('|')) {
      const [ts, idv] = cursor.split('|');
      where.push('(p.created_at < ? OR (p.created_at=? AND p.id < ?))');
      args.push(ts, ts, idv);
    }
    const rows = sql(`SELECT p.*, c.name_ur AS category_ur, c.name_en AS category_en, c.slug AS category_slug,
      b.name_ur AS brand_ur, b.name_en AS brand_en,
      (SELECT COALESCE(SUM(sb.qty_milli),0) FROM stock_balance sb WHERE sb.product_id=p.id) AS stock_milli
      FROM products p JOIN product_categories c ON c.id=p.category_id AND c.deleted=0
      LEFT JOIN brands b ON b.id=p.brand_id AND b.deleted=0
      WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, ...args, limit);
    const last = rows[rows.length - 1];
    return envelope({ rows, next_cursor: rows.length < limit || !last ? null : `${last.created_at}|${last.id}` });
  }

  /** catalogue.ts:252 — one product, its images and its live batches. */
  function readProduct(id) {
    if (!store.hasTable('products')) return null;
    const row = sqlOne(`SELECT p.*, c.name_ur AS category_ur, c.name_en AS category_en, c.slug AS category_slug,
      b.name_ur AS brand_ur, b.name_en AS brand_en,
      (SELECT COALESCE(SUM(sb.qty_milli),0) FROM stock_balance sb WHERE sb.product_id=p.id) AS stock_milli
      FROM products p JOIN product_categories c ON c.id=p.category_id AND c.deleted=0
      LEFT JOIN brands b ON b.id=p.brand_id AND b.deleted=0 WHERE p.id=? AND p.deleted=0`, id);
    if (!row) return fail(404, 'NOT_FOUND', { entity: 'products', id });
    const images = store.hasTable('product_images') ? sql('SELECT * FROM product_images WHERE product_id=? ORDER BY sort', id) : [];
    const batches = store.hasTable('product_batches')
      ? sql('SELECT * FROM product_batches WHERE product_id=? AND deleted=0 ORDER BY expiry_date', id) : [];
    return envelope({ ...row, images, batches });
  }

  /** catalogue.ts:529 — categories with the live product count the shelf tiles show. */
  function readCategories() {
    if (!store.hasTable('product_categories')) return null;
    return envelope(sql(`SELECT cat.id,cat.code,cat.parent_id,cat.name_ur,cat.name_en,cat.slug,cat.book_code,cat.icon,cat.sort,
      cat.is_active,cat.is_system,cat.created_at,cat.updated_at,cat.version,
      (SELECT COUNT(*) FROM products p WHERE p.category_id=cat.id AND p.deleted=0 AND p.is_published=1 AND p.is_active=1) AS product_count
      FROM product_categories cat WHERE cat.deleted=0 ORDER BY cat.sort,cat.name_ur LIMIT 200`));
  }

  /** transactions.ts:117 — parties with their current balance, straight off the pulled balance table. */
  function readParties(query) {
    if (!store.hasTable('parties')) return null;
    const where = ['p.is_active=1', 'p.deleted=0'];
    const args = [];
    if (query.type) { where.push('p.type=?'); args.push(String(query.type)); }
    const q = String(query.q ?? '').trim();
    if (q) { where.push('(p.name_ur LIKE ? OR p.name_en LIKE ? OR p.phone LIKE ?)'); args.push(like(q), like(q), like(q)); }
    const limit = Math.min(500, Math.max(1, num(query.limit) ?? 100));
    const join = store.hasTable('party_balance')
      ? 'LEFT JOIN party_balance pb ON pb.party_id=p.id' : '';
    const balance = store.hasTable('party_balance') ? 'COALESCE(pb.balance_paisa,0) AS balance_paisa' : '0 AS balance_paisa';
    return envelope(sql(`SELECT p.*,${balance} FROM parties p ${join}
      WHERE ${where.join(' AND ')} ORDER BY p.name_ur LIMIT ?`, ...args, limit));
  }

  /** checkout.ts:319 — the two coercions the handler does in JS, done here so the form sees the same. */
  function readPaymentMethods() {
    if (!store.hasTable('payment_methods')) return null;
    const rows = sql('SELECT * FROM payment_methods WHERE deleted=0 ORDER BY name_ur').map((r) => ({
      ...r, is_active: !!r.is_active, qr_url: r.qr_key ? `/media/${r.qr_key}` : '',
    }));
    return envelope(rows);
  }

  /** transactions.ts:159 — money books with balance and this month's in/out. */
  function readAccounts() {
    if (!store.hasTable('financial_accounts')) return null;
    const hasBalance = store.hasTable('account_balance');
    const hasTxn = store.hasTable('account_transactions');
    const balance = hasBalance
      ? '(SELECT COALESCE(ab.balance_paisa,0) FROM account_balance ab WHERE ab.account_id=fa.id)' : '0';
    const month = (direction) => (hasTxn
      ? `(SELECT COALESCE(SUM(CASE WHEN direction='${direction}' THEN amount_paisa ELSE 0 END),0)
          FROM account_transactions t WHERE t.account_id=fa.id AND t.date>=date('now','start of month'))`
      : '0');
    return envelope(sql(`SELECT fa.*,${balance} AS balance_paisa,
      ${month('IN')} AS month_in, ${month('OUT')} AS month_out
      FROM financial_accounts fa WHERE fa.deleted=0 ORDER BY fa.code`));
  }

  /** transactions.ts:51/46 — the invoice lists: date range, filters, keyset over (created_at,id). */
  function readInvoiceList(entity, route, query) {
    const table = registry.entityOf(entity)?.table ?? entity;   // identifiers never come from the caller
    if (!store.hasTable(table)) return null;
    const where = [];
    const args = [];
    if (query.from) { where.push('date>=?'); args.push(String(query.from)); }
    if (query.to) { where.push('date<=?'); args.push(String(query.to)); }
    for (const [param, column] of Object.entries(route.filters ?? {})) {
      if (query[param]) { where.push(`${column}=?`); args.push(String(query[param])); }
    }
    const cursor = String(query.cursor ?? '');
    if (cursor.includes('|')) {
      const [ts, idv] = cursor.split('|');
      where.push('(created_at < ? OR (created_at=? AND id < ?))');
      args.push(ts, ts, idv);
    }
    const limit = Math.min(100, Math.max(1, num(query.limit) ?? 25));
    const rows = sql(`SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`, ...args, limit);
    const last = rows[rows.length - 1];
    return envelope({ rows, next_cursor: rows.length < limit || !last ? null : `${last.created_at}|${last.id}` });
  }

  /** transactions.ts:63 — one sale with its lines and its payment allocations. */
  function readSale(id) {
    if (!store.hasTable('sales')) return null;
    const row = sqlOne('SELECT * FROM sales WHERE id=?', id);
    if (!row) return fail(404, 'NOT_FOUND', { entity: 'sales', id });
    const lines = store.hasTable('sale_items') ? sql('SELECT * FROM sale_items WHERE sale_id=? ORDER BY rowid', id) : [];
    const allocations = store.hasTable('payment_allocations')
      ? sql("SELECT * FROM payment_allocations WHERE invoice_type='SALE' AND invoice_id=?", id) : [];
    return envelope({ ...row, lines, allocations });
  }

  /** transactions.ts:61 — one purchase with its lines. */
  function readPurchase(id) {
    if (!store.hasTable('purchases')) return null;
    const row = sqlOne('SELECT * FROM purchases WHERE id=?', id);
    if (!row) return fail(404, 'NOT_FOUND', { entity: 'purchases', id });
    const lines = store.hasTable('purchase_items') ? sql('SELECT * FROM purchase_items WHERE purchase_id=? ORDER BY rowid', id) : [];
    return envelope({ ...row, lines });
  }

  /** transactions.ts:196 — expenses with the category name the list prints. */
  function readExpenses(query) {
    if (!store.hasTable('expenses')) return null;
    const where = ['1=1'];
    const args = [];
    if (query.from) { where.push('e.date>=?'); args.push(String(query.from)); }
    if (query.to) { where.push('e.date<=?'); args.push(String(query.to)); }
    return envelope(sql(`SELECT e.*,ec.name_ur AS category_ur FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id=e.category_id
      WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.created_at DESC LIMIT 200`, ...args));
  }

  /** transactions.ts:249 — batches with product name and remaining quantity. */
  function readStockBatches() {
    if (!store.hasTable('product_batches')) return null;
    const qty = store.hasTable('stock_batch_balance')
      ? 'COALESCE(sbb.qty_milli,0) AS qty_milli' : '0 AS qty_milli';
    const join = store.hasTable('stock_batch_balance') ? 'LEFT JOIN stock_batch_balance sbb ON sbb.batch_id=pb.id' : '';
    return envelope(sql(`SELECT pb.*,p.name_ur,${qty} FROM product_batches pb
      JOIN products p ON p.id=pb.product_id ${join}
      WHERE pb.deleted=0 ORDER BY pb.expiry_date IS NULL, pb.expiry_date LIMIT 200`));
  }

  /** ops.ts:26 — settings as an object keyed by name, each value parsed out of its JSON column. */
  function readSettings() {
    if (!store.hasTable('business_settings')) return null;
    const out = {};
    for (const r of sql('SELECT key,value,updated_at,updated_by FROM business_settings ORDER BY key')) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return envelope(out);
  }

  /** The generic path: a plain table, read through the store's own filter/order/paging builder. */
  function readPlain(route, query) {
    const opts = { limit: Math.min(1000, Math.max(1, num(query.limit) ?? 500)) };
    if (query.q) { opts.q = String(query.q); opts.qColumns = route.qColumns; }
    if (route.filters) {
      const where = {};
      for (const [param, column] of Object.entries(route.filters)) {
        if (query[param]) where[column] = String(query[param]);
      }
      if (Object.keys(where).length) opts.where = where;
    }
    if (route.order) opts.order = route.order;
    return store.list(route.entity, opts);
  }

  const CUSTOM = {
    products: (query) => readProducts(query),
    'product-detail': (query, id) => readProduct(id),
    categories: () => readCategories(),
    parties: (query) => readParties(query),
    'payment-methods': () => readPaymentMethods(),
    accounts: () => readAccounts(),
    'invoice-list': (query, id, route) => readInvoiceList(route.entity, route, query),
    'sale-detail': (query, id) => readSale(id),
    'purchase-detail': (query, id) => readPurchase(id),
    expenses: (query) => readExpenses(query),
    'stock-batches': () => readStockBatches(),
  };

  function localRead(res) {
    const route = res.route;
    const id = route.idParam ? String(res.matches[route.idParam]) : '';
    try {
      if (route.shape === 'settings') return readSettings() ?? fallback('no-settings-table');
      if (route.custom) {
        const out = CUSTOM[route.custom]?.(res.query, id, route);
        if (out === null || out === undefined) return fallback('no-mirror-for:' + route.custom);
        return out;
      }
      const page = readPlain(route, res.query);
      if (route.shape === 'rows') return envelope({ rows: page.rows, next_cursor: page.cursor });
      if (route.shape === 'keyed') return envelope({ [route.key]: page.rows });
      return envelope(page.rows);                    // shape 'list' — the server sends a bare array
    } catch (e) {
      // A mirror that cannot answer is not a problem the shop should see twice: log it, ask the API.
      log('local read failed — falling back to the API', { entity: route.entity, error: String(e?.message ?? e) });
      return fallback('read-threw');
    }
  }

  // =========================================================== local writes ====

  /** POST/PUT on a row-tier entity: write it, queue it, and reply with the ids the handler replies with. */
  function writeRow(res, body) {
    const route = res.route;
    const def = registry.rowEntity(route.entity);
    if (!def) return fail(400, 'BAD_REQUEST', { entity: route.entity });
    const payload = body && typeof body === 'object' ? { ...body } : null;
    if (!payload) return fail(400, 'BAD_REQUEST', { reason: 'no body' });

    let id = route.idParam ? String(res.matches[route.idParam]) : String(payload[def.pk] ?? '');
    if (route.keyedBy) {
      id = String(payload[route.keyedBy] ?? '');
      // The column holds JSON text; the form sends a value. The server's setSetting does the same.
      if (def.pk === 'key' && payload.value !== undefined) payload.value = JSON.stringify(payload.value);
    }
    if (route.upsertBy) {
      const existing = findLocal(def, route.upsertBy, payload);
      if (existing) id = String(existing[def.pk]);
      else if (def.pk === 'id') id = ulid();
      else return fail(404, 'NOT_FOUND', { looked_up_by: route.upsertBy });
    }
    if (!id) {
      // Part 3 of the brief: the desktop mints its own ids. SQLite autoincrement would give the server
      // a number two machines could both claim, and a collision is a silent overwrite of stock.
      if (def.pk !== 'id') return fail(400, 'BAD_REQUEST', { need: def.pk });
      id = ulid();
    }
    payload[def.pk] = id;

    const out = store.save(def.entity, payload);
    if (!out.ok) {
      if (out.error === 'STALE') return failure(409, CODE.STALE, { local_row: out.local_row });
      return fail(400, 'BAD_REQUEST', { code: out.error, message: out.message });
    }
    if (route.reply === 'ok') return envelope({ ok: true }, 201);
    if (route.reply === 'key') return envelope({ key: id });
    if (route.reply === 'product') return envelope({ id, slug: out.row?.slug ?? null, version: out.row?.version ?? 1 }, res.method === 'POST' ? 201 : 200);
    return envelope({ id, number: '', warnings: [], queued: true, op_id: out.queued_as }, res.method === 'POST' ? 201 : 200);
  }

  function findLocal(def, columns, payload) {
    const where = {};
    for (const c of columns) where[c] = payload[c];
    try { return store.list(def.entity, { where, limit: 1 }).rows[0] ?? null; } catch { return null; }
  }

  /** DELETE is a tombstone, here and on the server: a hard delete would orphan every invoice on it. */
  function deleteRow(res) {
    const route = res.route;
    const def = registry.rowEntity(route.entity);
    if (!def) return fail(400, 'BAD_REQUEST', { entity: route.entity });
    const id = String(res.matches[route.idParam ?? 1] ?? '');
    const out = store.remove(def.entity, id);
    if (!out.ok) {
      if (out.error === 'NOT_FOUND') return fail(404, 'NOT_FOUND', { entity: def.entity, id });
      return fail(400, 'BAD_REQUEST', { code: out.error, message: out.message });
    }
    return envelope({ id, deleted: 1, queued: true, op_id: out.queued_as });
  }

  /**
   * A document is an intention, not a row. The desktop queues it and says so: the server owns the
   * invoice number, the stock movement and the ledger, and a second implementation of those on the
   * counter PC is exactly how two machines end up disagreeing about money.
   */
  function queueCommand(res, body) {
    const payload = restMap.payloadWithRoute(res, body);
    // A web outbox body keeps its own identity and its own idea of when the shop made the entry.
    const out = store.command(res.opType, { ...(body?.local_time ? { local_time: body.local_time } : {}), ...payload }, res.idempotencyKey);
    if (!out.ok) return fail(400, 'BAD_REQUEST', { code: out.error, message: out.message });
    // `provisional` is the contract the invoice forms already speak: an offline web save shows the
    // same PROVISIONAL chip. A number is the server's to issue, so the placeholder says so plainly
    // instead of showing a blank, and the real invoice arrives with the next pull.
    return envelope({ queued: true, op_id: out.queued_as, id: null, provisional: true,
      number: `PENDING-${String(out.queued_as).slice(-6)}`, idempotency_key: out.idempotency_key,
      warnings: [] }, 202);
  }

  // =============================================================== dispatch ====

  function hasMirror() {
    try {
      if (store.meta.get('last_synced_at')) return true;
      // A database that already holds rows is a mirror, even if this run has not synced yet.
      for (const table of ['products', 'parties', 'business_settings']) {
        if (store.hasTable(table) && Number(sqlOne(`SELECT COUNT(*) c FROM ${table}`)?.c ?? 0) > 0) return true;
      }
      return false;
    } catch { return false; }
  }

  async function forwardTo(res, method, url, body, reason) {
    if (!http?.forward) return fail(503, 'OFFLINE', { reason });
    const out = await http.forward(method, url, body);
    // `null` means the transport could not reach the API at all — not an error the shop made.
    return out ?? fail(503, 'OFFLINE', { reason });
  }

  /**
   * @param {string} method
   * @param {string} url  path + query, exactly as the renderer wrote it
   * @param {unknown} body parsed JSON body or undefined
   */
  async function handle(method, url, body) {
    const res = restMap.resolve(method, url, body);
    const m = String(method).toUpperCase();
    if (!res) {
      if (!http?.forward) return fail(503, 'OFFLINE', { reason: 'unmapped' });
      return http.reachable?.() ? forwardTo(res, m, url, body, 'unmapped') : fail(503, 'OFFLINE', { reason: 'unmapped' });
    }

    if (res.kind === 'local-read') {
      // The mirror is only authoritative once it holds something. A first run has an empty database and
      // a live network; answering from it would show an empty ERP and teach the shop that the app
      // "lost" their products. So: download first, then answer locally.
      if (!hasMirror()) {
        if (http?.reachable?.()) return forwardTo(res, m, url, body, 'cold-mirror');
        return fail(503, 'OFFLINE', { reason: 'no local mirror yet — sign in online once to download it' });
      }
      const local = localRead(res);
      if (local?.local === false) {
        return http?.reachable?.() ? forwardTo(res, m, url, body, local.reason) : fail(503, 'OFFLINE', { reason: local.reason });
      }
      return local;
    }

    // Writes are local-first even when the network is fine: one path, so saving behaves identically at
    // 3am on a dead line and at noon on a good one. The queue is the record either way.
    if (res.kind === 'local-write') return writeRow(res, body);
    if (res.kind === 'local-delete') return deleteRow(res);
    if (res.kind === 'command') return queueCommand(res, body);

    if (http?.reachable?.()) return forwardTo(res, m, url, body, 'remote-tier');
    return fail(503, 'OFFLINE');
  }

  return { handle, hasMirror, envelope, fail };
}

module.exports = { createRestServe, envelope, failure, CODE };
