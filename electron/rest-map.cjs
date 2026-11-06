/**
 * Which API calls the desktop may answer from its own SQLite mirror, and which must go to the server.
 *
 * The rule is one sentence: **if the mirror holds the rows and the handler is a SELECT the desktop can
 * replay, answer locally; if the answer is an aggregate the server computes, forward it.**
 *
 * Every entry below was read out of the worker's own handlers, and the shape column is the worker's
 * payload key for key — `{rows, next_cursor}` where that is what the API sends, a bare array where the
 * API sends one, an object keyed by setting name for `/settings`. A screen must never be able to tell
 * which side answered it, because a screen that can tell is a screen with a desktop branch in it.
 *
 * The tiers:
 *   row      — master data. Read locally, written locally, queued as a row op. Fully offline.
 *   command  — a financial document. Queued as a command; the server numbers it, moves the stock and
 *              posts the ledger, so the desktop never invents those rows. Visible in the queue at once,
 *              in the lists after the next pull.
 *   replica  — server-derived rows the desktop only reads (invoices, payments, batches).
 *   remote   — everything else: dashboards, reports, khata, auth, uploads. Forwarded when reachable,
 *              a clear 503 `OFFLINE_UNAVAILABLE` when not.
 *
 * `custom` names a query in rest-serve.cjs that must be replayed as SQL, because the server's answer is
 * a join or a correlated subquery — the balance on a party, the stock on a product, the count on a
 * category. Those tables are pulled, so the numbers are as current as the last sync, and nothing is
 * duplicated in spirit: one SELECT, written twice because it runs against two databases.
 */
'use strict';

const ID = '([0-9A-Za-z._:-]{1,64})';
const idPath = (prefix) => new RegExp(`^/api/v1/${prefix}/${ID}/?$`);

const ROUTES = [
  // ------------------------------------------------------------- catalogue ----
  { method: 'GET', path: /^\/api\/v1\/products\/?$/, tier: 'row', entity: 'products', custom: 'products' },
  { method: 'POST', path: /^\/api\/v1\/products\/?$/, tier: 'row', entity: 'products', reply: 'product' },
  { method: 'GET', path: idPath('products'), tier: 'row', entity: 'products', custom: 'product-detail', idParam: 1 },
  { method: 'PUT', path: idPath('products'), tier: 'row', entity: 'products', idParam: 1, reply: 'product' },

  { method: 'GET', path: /^\/api\/v1\/categories\/?$/, tier: 'row', entity: 'categories', custom: 'categories' },
  { method: 'POST', path: /^\/api\/v1\/categories\/?$/, tier: 'row', entity: 'categories' },
  { method: 'PUT', path: idPath('categories'), tier: 'row', entity: 'categories', idParam: 1 },

  { method: 'GET', path: /^\/api\/v1\/brands\/?$/, tier: 'row', entity: 'brands', shape: 'list' },
  { method: 'POST', path: /^\/api\/v1\/brands\/?$/, tier: 'row', entity: 'brands' },
  { method: 'PUT', path: idPath('brands'), tier: 'row', entity: 'brands', idParam: 1 },

  { method: 'GET', path: /^\/api\/v1\/units\/?$/, tier: 'row', entity: 'unit_conversions', shape: 'list' },
  // The server upserts on (from_unit,to_unit); the desktop finds the local row the same way, so the
  // business key keeps its id instead of minting a duplicate.
  { method: 'POST', path: /^\/api\/v1\/units\/?$/, tier: 'row', entity: 'unit_conversions', upsertBy: ['from_unit', 'to_unit'], reply: 'ok' },

  // --------------------------------------------------------------- money ----
  { method: 'GET', path: /^\/api\/v1\/parties\/?$/, tier: 'row', entity: 'parties', custom: 'parties' },
  // A plain party is master data. A party that opens with a balance is a ledger event and belongs to
  // the posting engine: queued as a PARTY command, visible once the server has posted it.
  { method: 'POST', path: /^\/api\/v1\/parties\/?$/, tier: 'row', entity: 'parties',
    unless: (body) => Number(body?.opening_balance_paisa) !== 0, commandWhen: 'PARTY' },
  { method: 'PUT', path: idPath('parties'), tier: 'row', entity: 'parties', idParam: 1 },

  { method: 'GET', path: /^\/api\/v1\/payment-methods\/?$/, tier: 'row', entity: 'payment_methods', custom: 'payment-methods' },
  { method: 'POST', path: /^\/api\/v1\/payment-methods\/?$/, tier: 'row', entity: 'payment_methods' },
  { method: 'PUT', path: idPath('payment-methods'), tier: 'row', entity: 'payment_methods', idParam: 1 },
  { method: 'DELETE', path: idPath('payment-methods'), tier: 'row', entity: 'payment_methods', idParam: 1 },

  { method: 'GET', path: /^\/api\/v1\/expense-categories\/?$/, tier: 'row', entity: 'expense_categories', shape: 'list' },
  { method: 'GET', path: /^\/api\/v1\/employees\/?$/, tier: 'row', entity: 'employees', shape: 'list' },
  { method: 'POST', path: /^\/api\/v1\/employees\/?$/, tier: 'row', entity: 'employees' },
  { method: 'GET', path: /^\/api\/v1\/accounts\/?$/, tier: 'row', entity: 'financial_accounts', custom: 'accounts' },
  { method: 'GET', path: /^\/api\/v1\/accounting\/chart\/?$/, tier: 'row', entity: 'chart_of_accounts', shape: 'list' },

  { method: 'GET', path: /^\/api\/v1\/settings\/?$/, tier: 'row', entity: 'settings', shape: 'settings' },
  { method: 'PUT', path: /^\/api\/v1\/settings\/?$/, tier: 'row', entity: 'settings', keyedBy: 'key', reply: 'key' },

  // -------------------------------------------------- documents (commands) ----
  { method: 'POST', path: /^\/api\/v1\/sales\/?$/, tier: 'command', opType: 'SALE' },
  { method: 'POST', path: /^\/api\/v1\/purchases\/?$/, tier: 'command', opType: 'PURCHASE' },
  { method: 'POST', path: /^\/api\/v1\/receipts\/?$/, tier: 'command', opType: 'RECEIPT' },
  { method: 'POST', path: /^\/api\/v1\/payments\/?$/, tier: 'command', opType: 'PAYMENT' },
  { method: 'POST', path: /^\/api\/v1\/expenses\/?$/, tier: 'command', opType: 'EXPENSE' },
  { method: 'POST', path: /^\/api\/v1\/grains\/([a-zA-Z_]+)\/purchase\/?$/, tier: 'command', opType: 'GRAIN_PURCHASE', cropParam: 1 },
  { method: 'POST', path: /^\/api\/v1\/grains\/([a-zA-Z_]+)\/sale\/?$/, tier: 'command', opType: 'GRAIN_SALE', cropParam: 1 },
  // The web's outbox posts `{ idempotency_key, type, payload, local_time }` here. On the desktop the
  // queue IS the local SQLite outbox, so the same body must land in it — forwarding would mean a sale
  // typed on a dead line is refused with a 503 and lost from the shop's screen.
  { method: 'POST', path: /^\/api\/v1\/sync\/push\/?$/, tier: 'command', opType: 'from-body', bodyKey: 'payload' },

  // Read-only mirrors of those documents: listable and viewable offline, never writable here.
  { method: 'GET', path: /^\/api\/v1\/sales\/?$/, tier: 'replica', entity: 'sales', custom: 'invoice-list',
    filters: { book_code: 'book_code', party_id: 'party_id', status: 'status' } },
  { method: 'GET', path: /^\/api\/v1\/purchases\/?$/, tier: 'replica', entity: 'purchases', custom: 'invoice-list',
    filters: { book_code: 'book_code', party_id: 'party_id', status: 'status' } },
  { method: 'GET', path: idPath('sales'), tier: 'replica', entity: 'sales', custom: 'sale-detail', idParam: 1 },
  { method: 'GET', path: idPath('purchases'), tier: 'replica', entity: 'purchases', custom: 'purchase-detail', idParam: 1 },
  { method: 'GET', path: /^\/api\/v1\/receipts\/?$/, tier: 'replica', entity: 'receipts', shape: 'list' },
  { method: 'GET', path: /^\/api\/v1\/payments\/?$/, tier: 'replica', entity: 'payments', shape: 'list' },
  { method: 'GET', path: /^\/api\/v1\/expenses\/?$/, tier: 'replica', entity: 'expenses', custom: 'expenses' },
  { method: 'GET', path: /^\/api\/v1\/stock\/batches\/?$/, tier: 'replica', entity: 'product_batches', custom: 'stock-batches' },
  { method: 'GET', path: /^\/api\/v1\/advances\/?$/, tier: 'replica', entity: 'employee_advances', shape: 'list' },

  // ------------------------------------------------------ must reach the API ----
  // Aggregates the desktop would have to reimplement wholesale (and get subtly wrong): the dashboard,
  // the khata, every report. Anything not matched above forwards by default.
  { method: 'GET', path: /^\/api\/v1\/(dashboard|stock|khata|reports|integrity|usage|devices|users|roles|audit|backup|documents|orders|statements|payroll|enquiries|grains|website|features|setup|auth)(\/|$)/, tier: 'remote' },
  { method: 'GET', path: idPath('parties'), tier: 'remote' },     // party ledger: 100 rows of running history
  { method: 'GET', path: idPath('accounts'), tier: 'remote' },    // account transactions + reconciliations
];

const parse = (url) => {
  const i = url.indexOf('?');
  return { path: i < 0 ? url : url.slice(0, i), query: Object.fromEntries(new URLSearchParams(i < 0 ? '' : url.slice(i + 1))) };
};

/**
 * @param {string} method
 * @param {string} url  path + query exactly as the renderer wrote it
 * @param {unknown} body parsed JSON body, when there is one
 * @returns {object|null} the route plus the parsed path segments, or null when nothing matched
 */
function resolve(method, url, body) {
  const { path, query } = parse(String(url ?? ''));
  const m = String(method ?? 'GET').toUpperCase();
  for (const route of ROUTES) {
    if (route.method !== m) continue;
    const matches = route.path.exec(path);
    if (!matches) continue;
    const base = { method: m, route, path, query, matches };
    // A party WITH an opening balance is not master data — it is a ledger event. Same URL, other tier.
    if (route.unless && route.unless(body)) return { ...base, kind: 'command', opType: route.commandWhen };
    if (route.tier === 'command') {
      // `from-body`: the document type travels inside the JSON, as it does on the web outbox endpoint.
      const opType = route.opType === 'from-body' ? String(body?.type ?? '') : route.opType;
      return { ...base, kind: 'command', opType, idempotencyKey: route.bodyKey === 'payload' ? body?.idempotency_key : undefined };
    }
    if (route.tier === 'remote') return { ...base, kind: 'remote' };
    return { ...base, kind: m === 'GET' ? 'local-read' : m === 'DELETE' ? 'local-delete' : 'local-write' };
  }
  return null;                                                 // unmapped: forwarded, never guessed
}

/** The crop in `/grains/:crop/purchase` is part of the document, so it has to reach the payload. */
function payloadWithRoute(res, body) {
  // A `{ type, payload }` envelope carries the document inside `payload`; everything else IS the
  // document, and wrapping it again would post an empty sale.
  if (res.route?.bodyKey === 'payload') {
    const inner = body && typeof body === 'object' ? body.payload : null;
    return inner && typeof inner === 'object' ? { ...inner } : {};
  }
  const payload = body && typeof body === 'object' ? { ...body } : {};
  const param = res.route?.cropParam;
  if (param && res.matches?.[param]) payload.crop = res.matches[param];
  return payload;
}

module.exports = { resolve, ROUTES, payloadWithRoute, ID };
