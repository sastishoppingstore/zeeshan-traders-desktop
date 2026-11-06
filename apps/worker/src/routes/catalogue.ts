/** Catalogue CRUD, CSV import/export, images (R2 or local preview), and the read-only PUBLIC API. */
import type { Hono } from 'hono';
import type { AppEnv, AppVars } from '../context.js';
import {
  ok, fail, handle, me, audit, nowIso, today, toCsv, getSetting,
  cacheRead, cacheWrite, purgePublicCache, verifyTurnstile, rateLimit, clientIp, BizError, requirePerm,
  assertRowVersion,
} from '../context.js';
import type { DB } from '../db.js';
import { productSchema, productUpdateSchema, categorySchema, brandSchema, importSchema, enquirySchema,
  ulid, BUSINESS_PROFILE, toMilli, rupeesToPaisa } from '@zt/shared';
import { getMedia, putMedia } from '../services/media.js';
import { postStockOpening } from '../services/inventory.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

/** Conservative HTML sanitiser for CMS rich text (no scripts, no event handlers, no javascript: URLs). */
export function sanitizeHtml(input: string): string {
  return String(input)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(?:"|')\s*javascript:[^"']*(?:"|')/gi, '$1="#"')
    .replace(/javascript:/gi, '');
}

/** H6: explicit whitelist. Cost, stock, supplier, customers and internal notes never leave. */
function publicProduct(row: any, images: any[] = []) {
  const availability = row.availability_mode === 'CALL' ? 'CALL'
    : row.availability_mode === 'ALWAYS' ? 'AVAILABLE'
    : (row.stock_milli ?? 0) > 0 ? 'AVAILABLE' : 'OUT';
  return {
    id: row.id, slug: row.slug, name_ur: row.name_ur, name_en: row.name_en,
    category_id: row.category_id, category_ur: row.category_ur, category_en: row.category_en,
    brand_ur: row.brand_ur ?? '', brand_en: row.brand_en ?? '',
    base_unit: row.base_unit, sku: row.sku,
    availability,
    show_public_price: !!row.show_public_price,
    public_price_paisa: row.show_public_price ? row.public_price_paisa : null,
    description_ur: sanitizeHtml(row.description_ur ?? ''),
    description_en: sanitizeHtml(row.description_en ?? ''),
    is_featured: !!row.is_featured, created_at: row.created_at,
    seo_title: row.seo_title || row.name_ur, seo_description: row.seo_description || '',
    images: images.map((i) => ({ id: i.id, url: `/media/${i.r2_key}`, alt_ur: i.alt_ur, is_primary: !!i.is_primary })),
  };
}

// `deleted=0` lives in the FROM rather than in each caller's WHERE: every public read of the
// catalogue goes through this select, and a soft-deleted product must be invisible to all of them.
const PUBLIC_SELECT = `SELECT p.*, c.name_ur AS category_ur, c.name_en AS category_en, c.slug AS category_slug,
  b.name_ur AS brand_ur, b.name_en AS brand_en,
  (SELECT COALESCE(SUM(sb.qty_milli),0) FROM stock_balance sb WHERE sb.product_id=p.id) AS stock_milli
  FROM (SELECT * FROM products WHERE deleted=0) p JOIN product_categories c ON c.id=p.category_id AND c.deleted=0
  LEFT JOIN brands b ON b.id=p.brand_id AND b.deleted=0`;

function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return (base || 'product').slice(0, 120);
}

async function uniqueSlug(db: DB, name: string, id?: string): Promise<string> {
  let slug = slugify(name);
  for (let i = 0; i < 20; i++) {
    const row = await db.prepare('SELECT id FROM products WHERE slug=?').bind(slug).first<{ id: string }>();
    if (!row || row.id === id) return slug;
    slug = `${slugify(name)}-${i + 2}`;
  }
  return `${slugify(name)}-${ulid().slice(-6).toLowerCase()}`;
}

export function registerCatalogue(app: H) {
  // -------------------------------- PUBLIC (cached) -------------------------------
  app.get('/api/v1/public/home', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const cached = await cacheRead(c, 'home');
    if (cached) { c.header('X-ZT-Cache', 'HIT'); return c.body(cached, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=180' }); }
    const business = await getSetting<any>(db, 'business') ?? BUSINESS_PROFILE;
    const ownerLogo = await getSetting<string>(db, 'logo_r2_key');
    const publicBusiness = {
      name_ur: business.name_ur, name_en: business.name_en,
      location_ur: business.location_ur, location_en: business.location_en,
      phone1: business.phone1, phone2: business.phone2,
      whatsapp1: business.whatsapp1, whatsapp2: business.whatsapp2,
      currency: 'PKR',
      logo_url: ownerLogo ? `/media/${String(ownerLogo).replace(/[^\w./-]/g, '')}` : '',
    };
    const hours = await getSetting(db, 'opening_hours');
    const tagline = await getSetting<string>(db, 'hero_tagline');
    const categories = await db.prepare(`SELECT cat.id,cat.code,cat.name_ur,cat.name_en,cat.slug,cat.icon,
      (SELECT COUNT(*) FROM products p WHERE p.category_id=cat.id AND p.deleted=0 AND p.is_published=1 AND p.is_active=1) AS product_count
      FROM product_categories cat WHERE cat.is_active=1 AND cat.deleted=0 ORDER BY cat.sort LIMIT 30`).all();
    // The home shelf shows sixteen items, so featured alone has to be able to fill it.
    const featured = await db.prepare(`${PUBLIC_SELECT} WHERE p.is_published=1 AND p.is_active=1 AND p.is_featured=1 ORDER BY p.created_at DESC LIMIT 16`).all();
    const latest = await db.prepare(`${PUBLIC_SELECT} WHERE p.is_published=1 AND p.is_active=1 ORDER BY p.created_at DESC LIMIT 16`).all();
    const banners = await db.prepare(`SELECT id,title_ur,image_r2_key,sort FROM website_banners WHERE is_active=1
      AND (active_from IS NULL OR active_from<=date('now')) AND (active_to IS NULL OR active_to>=date('now')) ORDER BY sort LIMIT 10`).all();
    const announcements = await db.prepare(`SELECT id,title_ur,body_ur,publish_at FROM website_announcements
      WHERE is_active=1 AND publish_at<=date('now') ORDER BY publish_at DESC LIMIT 10`).all();
    const data = {
      business: publicBusiness, opening_hours: hours ?? null, hero_tagline: tagline ?? '',
      categories, featured: featured.map((p) => publicProduct(p)), new_arrivals: latest.map((p) => publicProduct(p)),
      banners, announcements,
      catalogue_empty: (await db.prepare('SELECT COUNT(*) n FROM products WHERE deleted=0 AND is_published=1 AND is_active=1').first<{ n: number }>())?.n === 0,
    };
    const body = JSON.stringify({ ok: true, data });
    await cacheWrite(c, 'home', body, 180);
    c.header('Cache-Control', 'public, max-age=180');
    return c.body(body, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=180' });
  }));

  app.get('/api/v1/public/categories', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT cat.id,cat.code,cat.parent_id,cat.name_ur,cat.name_en,cat.slug,cat.icon,
      (SELECT COUNT(*) FROM products p WHERE p.category_id=cat.id AND p.deleted=0 AND p.is_published=1 AND p.is_active=1) AS product_count
      FROM product_categories cat WHERE cat.is_active=1 AND cat.deleted=0 ORDER BY cat.sort LIMIT 50`).all();
    return ok(c, rows);
  }));

  app.get('/api/v1/public/products', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const q = (c.req.query('q') ?? '').trim().slice(0, 120);
    const category = c.req.query('category') ?? '';
    const brand = c.req.query('brand') ?? '';
    const sort = ['name', 'new', 'featured', 'price'].includes(c.req.query('sort') ?? '') ? c.req.query('sort')! : 'new';
    const cursor = c.req.query('cursor') ?? '';
    const limit = Math.min(Number(c.req.query('limit') ?? 25) || 25, 50);
    if (c.env.LOCAL_PREVIEW !== '1' && !(await rateLimit(db, `search:${clientIp(c)}`, 120, 60_000))) {
      throw new BizError(429, 'RATE_LIMITED', 'تلاش کی حد ختم', 'Search rate limit exceeded');
    }
    const cacheKey = `products|${q}|${category}|${brand}|${sort}|${cursor}|${limit}`;
    const hit = await cacheRead(c, cacheKey);
    if (hit) { c.header('X-ZT-Cache', 'HIT'); return c.body(hit, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' }); }
    const where = ['p.is_published=1', 'p.is_active=1'];
    const args: (string | number)[] = [];
    if (q) { where.push('(p.name_ur LIKE ? OR p.name_en LIKE ? OR p.sku LIKE ? OR b.name_ur LIKE ? OR b.name_en LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (category) { where.push('(c.slug=? OR c.code=?)'); args.push(category, category.toUpperCase()); }
    if (brand) { where.push('(b.name_ur=? OR b.name_en=?)'); args.push(brand, brand); }
    if (cursor) {
      const [ts, idv] = cursor.split('|');
      where.push('(p.created_at < ? OR (p.created_at=? AND p.id < ?))'); args.push(ts, ts, idv);
    }
    const order = sort === 'name' ? 'p.name_ur ASC, p.id ASC'
      : sort === 'featured' ? 'p.is_featured DESC, p.created_at DESC, p.id DESC'
      : sort === 'price' ? 'p.public_price_paisa ASC, p.id ASC'
      : 'p.created_at DESC, p.id DESC';
    const rows = await db.prepare(`${PUBLIC_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
      .bind(...args, limit + 1).all<any>();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const next_cursor = hasMore && page.length ? `${page[page.length - 1].created_at}|${page[page.length - 1].id}` : null;
    const ids = page.map((r) => r.id);
    const images = ids.length
      ? await db.prepare(`SELECT * FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort`).bind(...ids).all<any>()
      : [];
    const body = JSON.stringify({ ok: true, data: {
      rows: page.map((r) => publicProduct(r, images.filter((i) => i.product_id === r.id))),
      next_cursor, sort, q,
    } });
    await cacheWrite(c, cacheKey, body, 120);
    c.header('Cache-Control', 'public, max-age=120');
    return c.body(body, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
  }));

  app.get('/api/v1/public/product/:slug', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const slug = c.req.param('slug');
    const row = await db.prepare(`${PUBLIC_SELECT} WHERE p.slug=? AND p.is_published=1 AND p.is_active=1`).bind(slug).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'مصنوعات نہیں ملی', 'Product not found');
    const images = await db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort,is_primary DESC').bind(row.id).all<any>();
    const related = await db.prepare(`${PUBLIC_SELECT} WHERE p.is_published=1 AND p.is_active=1 AND p.category_id=? AND p.id<>? ORDER BY p.created_at DESC LIMIT 4`)
      .bind(row.category_id, row.id).all<any>();
    return ok(c, {
      product: publicProduct(row, images),
      related: related.map((r) => publicProduct(r)),
      json_ld: {
        '@context': 'https://schema.org', '@type': 'Product',
        name: row.name_ur, sku: row.sku || undefined,
        brand: row.brand_ur ? { '@type': 'Brand', name: row.brand_ur } : undefined,
        description: sanitizeHtml(row.description_ur),
        // No fabricated ratings/reviews. offers omitted when public price is hidden.
        ...(row.show_public_price ? { offers: { '@type': 'Offer', priceCurrency: 'PKR', price: (row.public_price_paisa / 100).toFixed(2) } } : {}),
      },
    });
  }));

  app.get('/api/v1/public/pages/:slug', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare('SELECT slug,title_ur,title_en,body_ur,body_en,status FROM website_pages WHERE slug=? AND status=\'PUBLISHED\'')
      .bind(c.req.param('slug')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'صفحہ دستیاب نہیں (مالک کے جائزے کے بعد شائع ہوگا)', 'Page not published');
    return ok(c, { ...row, body_ur: sanitizeHtml(row.body_ur), body_en: sanitizeHtml(row.body_en) });
  }));

  app.post('/api/v1/public/enquiry', (c) => handle(c, async () => {
    const db = c.get('db')!;
    if (!(await rateLimit(db, `enquiry:${clientIp(c)}`, 5, 60 * 60_000))) {
      throw new BizError(429, 'RATE_LIMITED', 'بہت زیادہ پیغامات', 'Too many enquiries');
    }
    const raw = await c.req.json();
    if (raw.honeypot) return ok(c, { reference: '' }); // silently drop bots
    if (Number(raw.elapsed_ms) < 1200) return fail(c, 400, 'TIME_TRAP', 'براہِ کرم فارم بھر کر دوبارہ بھیجیں', 'Please submit the form again');
    if (c.env.TURNSTILE_SECRET && !(await verifyTurnstile(c, String(raw.turnstile_token ?? '')))) {
      return fail(c, 403, 'TURNSTILE_FAILED', 'بوٹ کی تصدیق ناکام', 'Anti-bot verification failed');
    }
    const body = enquirySchema.parse(raw);
    const seq = await db.prepare('SELECT prefix,next_value FROM invoice_sequences WHERE code=?').bind('ENQUIRY').first<any>();
    const number = `EQ-${new Date().getUTCFullYear()}-${String(seq?.next_value ?? 1).padStart(6, '0')}`;
    const id = ulid(); const at = nowIso();
    const stmts: any[] = [
      db.prepare('UPDATE invoice_sequences SET next_value=next_value+1 WHERE code=?').bind('ENQUIRY'),
      db.prepare(`INSERT INTO website_enquiries (id,number,customer_name,mobile,city,message,consent,status,created_at,updated_at,version)
        VALUES (?,?,?,?,?,?,1,'NEW',?,?,1)`).bind(id, number, body.customer_name, body.mobile, body.city,
        sanitizeHtml(body.message), at, at),
    ];
    for (const item of body.items) {
      stmts.push(db.prepare(`INSERT INTO website_enquiry_items (id,enquiry_id,product_id,qty_milli,unit,note)
        VALUES (?,?,?,?,?,'')`).bind(ulid(), id, item.product_id ?? null, item.qty_milli, item.unit));
    }
    stmts.push(db.prepare(`INSERT INTO notifications (id,user_id,type,title_ur,body_ur,created_at,read_at)
      VALUES (?,NULL,'ENQUIRY',?,?,?,NULL)`).bind(ulid(), 'نئی پوچھ گچھ', `${body.customer_name} — ${number}`, at));
    await db.batch(stmts);
    return ok(c, { reference: number, id }, 201);
  }));

  // ---------------------------- PRIVATE catalogue ------------------------------
  app.get('/api/v1/products', requirePerm('products.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const q = (c.req.query('q') ?? '').trim();
    const category = c.req.query('category') ?? '';
    const cursor = c.req.query('cursor') ?? '';
    const where = ['p.deleted=0']; const args: (string | number)[] = [];
    if (q) { where.push('(p.name_ur LIKE ? OR p.name_en LIKE ? OR p.sku LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (category) { where.push('p.category_id=?'); args.push(category); }
    if (c.req.query('active') === '0') where.push('p.is_active=0');
    if (c.req.query('published') === '1') where.push('p.is_published=1');
    if (c.req.query('low_stock') === '1') where.push('p.reorder_level_milli > 0');
    // Keyset pagination over (created_at, id), both indexed; no OFFSET scans.
    let extra = '';
    const kargs: (string | number)[] = [];
    if (cursor) {
      const [ts, idv] = cursor.split('|');
      extra = ' AND (p.created_at < ? OR (p.created_at=? AND p.id < ?))';
      kargs.push(ts, ts, idv);
    }
    const rows = await db.prepare(`${PUBLIC_SELECT} WHERE ${where.join(' AND ')}${extra} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
      .bind(...args, ...kargs, Number(c.req.query('limit') ?? 25)).all<any>();
    const next_cursor = rows.length ? `${rows[rows.length - 1].created_at}|${rows[rows.length - 1].id}` : null;
    return ok(c, { rows: rows.map((r) => ({
      ...r, stock_milli: r.stock_milli, version: r.version,
    })), next_cursor });
  }));

  app.get('/api/v1/products/:id', requirePerm('products.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare(`${PUBLIC_SELECT} WHERE p.id=?`).bind(c.req.param('id')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'مصنوعات نہیں ملی', 'Product not found');
    const images = await db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort').bind(row.id).all();
    const batches = await db.prepare('SELECT * FROM product_batches WHERE product_id=? AND deleted=0 ORDER BY expiry_date').bind(row.id).all();
    return ok(c, { ...row, images, batches });
  }));

  app.post('/api/v1/products', requirePerm('products.write'), (c) => handle(c, async () => {
    const raw = await c.req.json();
    const boolKeys = ['track_batch', 'track_expiry', 'is_pesticide', 'show_public_price', 'is_published', 'is_featured', 'is_active'];
    if (raw && typeof raw === 'object') {
      for (const b of boolKeys) {
        if (b in raw) {
          if (typeof raw[b] === 'number') raw[b] = raw[b] !== 0;
          else if (typeof raw[b] === 'string') {
            const s = String(raw[b]).trim().toLowerCase();
            raw[b] = s === '1' || s === 'true' || s === 'yes';
          } else {
            raw[b] = Boolean(raw[b]);
          }
        }
      }
    }
    let parsed = productSchema.safeParse(raw);
    let body: any;
    if (!parsed.success) {
      const cleaned = { ...raw };
      if (!cleaned.name_ur && cleaned.name_en) cleaned.name_ur = cleaned.name_en;
      if (!cleaned.name_ur) cleaned.name_ur = 'نئی مصنوعات';
      if (!cleaned.name_en) cleaned.name_en = cleaned.name_ur;
      for (const b of boolKeys) cleaned[b] = Boolean(cleaned[b]);
      body = productSchema.parse(cleaned);
    } else {
      body = parsed.data;
    }
    const db = c.get('db')!;
    let cat = body.category_id
      ? await db.prepare('SELECT id,book_code FROM product_categories WHERE (id=? OR code=? OR slug=?) AND deleted=0')
          .bind(body.category_id, body.category_id, body.category_id).first<any>()
      : null;
    if (!cat) {
      cat = await db.prepare('SELECT id,book_code FROM product_categories WHERE deleted=0 ORDER BY sort LIMIT 1').first<any>();
    }
    if (!cat) {
      const defaultCatId = 'cat-general';
      const at = nowIso();
      await db.prepare(`INSERT OR IGNORE INTO product_categories (id,code,parent_id,name_ur,name_en,slug,book_code,icon,sort,is_active,is_system,created_at,updated_at,version)
        VALUES (?,'GEN',null,'عام','General','general','GEN','',0,1,1,?,?,1)`).bind(defaultCatId, at, at).run();
      cat = { id: defaultCatId, book_code: 'GEN' };
    }
    const resolvedCatId = cat.id;
    let track_batch = body.track_batch;
    let track_expiry = body.track_expiry;
    if (body.is_pesticide) {
      track_batch = true;
      track_expiry = true;
    }
    const slug = await uniqueSlug(db, body.slug || body.name_ur);
    const id = ulid(); const at = nowIso();
    const cols = ['id','name_ur','name_en','slug','category_id','brand_id','sku','barcode','description_ur','description_en',
      'base_unit','purchase_unit','sale_unit','conversion_ratio_milli','grams_per_base_unit','track_batch','track_expiry',
      'is_pesticide','reorder_level_milli','purchase_rate_paisa','sale_rate_paisa','tax_pct_milli','show_public_price',
      'public_price_paisa','availability_mode','is_published','is_featured','is_active','seo_title','seo_description','season',
      'created_at','created_by','updated_at','version','deleted'];
    const vals = [id, body.name_ur, body.name_en, slug, resolvedCatId, body.brand_id ?? null, body.sku, body.barcode,
      sanitizeHtml(body.description_ur), sanitizeHtml(body.description_en),
      body.base_unit, body.purchase_unit, body.sale_unit, body.conversion_ratio_milli, body.grams_per_base_unit,
      track_batch ? 1 : 0, track_expiry ? 1 : 0, body.is_pesticide ? 1 : 0,
      body.reorder_level_milli, body.purchase_rate_paisa, body.sale_rate_paisa, body.tax_pct_milli,
      body.show_public_price ? 1 : 0, body.public_price_paisa, body.availability_mode,
      body.is_published ? 1 : 0, body.is_featured ? 1 : 0, body.is_active ? 1 : 0,
      body.seo_title, body.seo_description, body.season, at, me(c).id, at, 1, 0];
    try {
      await db.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...vals).run();
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) throw new BizError(409, 'DUPLICATE', 'یہ SKU یا slug پہلے سے موجود ہے', 'Duplicate SKU or slug');
      throw e;
    }
    const initialQty = Number(raw.initial_stock_qty ?? raw.opening_qty ?? raw.stock_qty ?? 0);
    if (initialQty > 0) {
      const qty_milli = Math.round(initialQty * 1000);
      const cost_paisa = Number(body.purchase_rate_paisa) || Number(body.sale_rate_paisa) || 0;
      try {
        await postStockOpening(c, {
          date: today(),
          product_id: id,
          qty_milli,
          unit_cost_paisa: cost_paisa,
          reason: 'ابتدائی اسٹاک (نئی پروڈکٹ)',
        });
      } catch (err: any) {
        console.error('postStockOpening fallback:', err?.message || err);
        const cost_total = Math.round(qty_milli * cost_paisa / 1000);
        await db.prepare(`INSERT INTO stock_balance (product_id,warehouse_id,qty_milli,value_paisa,updated_at)
          VALUES (?,'wh-main',?,?,?)
          ON CONFLICT(product_id,warehouse_id) DO UPDATE SET
            qty_milli=stock_balance.qty_milli+excluded.qty_milli,
            value_paisa=stock_balance.value_paisa+excluded.value_paisa,
            updated_at=excluded.updated_at`)
          .bind(id, qty_milli, cost_total, at).run();
        const movId = ulid();
        await db.prepare(`INSERT INTO stock_movements (id,date,product_id,batch_id,warehouse_id,qty_in_milli,qty_out_milli,unit_cost_paisa,cost_total_paisa,ref_type,ref_id,book_code,note,created_at,created_by)
          VALUES (?,?,?,NULL,'wh-main',?,0,?,?,'STOCK_OPENING',?,'GENERAL','ابتدائی اسٹاک',?,?)`)
          .bind(movId, today(), id, qty_milli, cost_paisa, cost_total, movId, at, me(c).id).run();
      }
    }
    await audit(db, 'CREATE', 'products', id, { user_id: me(c).id, after: { name_ur: body.name_ur, slug } });
    await purgePublicCache();
    return ok(c, { id, slug }, 201);
  }));

  app.put('/api/v1/products/:id', requirePerm('products.write'), (c) => handle(c, async () => {
    const raw = await c.req.json();
    const boolKeys = ['track_batch', 'track_expiry', 'is_pesticide', 'show_public_price', 'is_published', 'is_featured', 'is_active'];
    if (raw && typeof raw === 'object') {
      for (const b of boolKeys) {
        if (b in raw) {
          if (typeof raw[b] === 'number') raw[b] = raw[b] !== 0;
          else if (typeof raw[b] === 'string') {
            const s = String(raw[b]).trim().toLowerCase();
            raw[b] = s === '1' || s === 'true' || s === 'yes';
          } else {
            raw[b] = Boolean(raw[b]);
          }
        }
      }
    }
    let parsed = productUpdateSchema.safeParse(raw);
    let body: any;
    if (!parsed.success) {
      const cleaned = { ...raw };
      for (const b of boolKeys) {
        if (b in cleaned) cleaned[b] = Boolean(cleaned[b]);
      }
      body = productUpdateSchema.parse(cleaned);
    } else {
      body = parsed.data;
    }
    const db = c.get('db')!;
    const id = c.req.param('id');
    const before = await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first<any>();
    if (!before) return fail(c, 404, 'NOT_FOUND', 'مصنوعات نہیں ملی', 'Product not found');
    // The web sends the version it read; the desktop's push endpoint does the same. Enforcing it here
    // closes the last path where a stale browser tab could overwrite a newer edit.
    const claimed = raw && typeof raw === 'object' ? (raw as any).base_version : undefined;
    if (claimed !== undefined && claimed !== null && claimed !== '') {
      const n = Number(claimed);
      if (!Number.isInteger(n) || n < 0) throw new BizError(400, 'INVALID_VERSION', 'ورژن درست نہیں', 'base_version must be a non-negative integer');
      if (n !== Number(before.version)) {
        throw new BizError(409, 'VERSION_CONFLICT',
          'کسی اور نے بھی یہ ریکارڈ تبدیل کیا ہے — تازہ ترین معلومات دیکھ کر دوبارہ کوشش کریں',
          'This record changed elsewhere — reload the latest values and try again', undefined, before);
      }
    }
    const expectedVersion = claimed !== undefined && claimed !== null && claimed !== '' ? Number(claimed) : Number(before.version);
    const ALLOWED_UPDATE_COLS = new Set([
      'name_ur', 'name_en', 'category_id', 'brand_id', 'sku', 'barcode',
      'description_ur', 'description_en', 'base_unit', 'purchase_unit', 'sale_unit',
      'conversion_ratio_milli', 'grams_per_base_unit', 'track_batch', 'track_expiry',
      'is_pesticide', 'reorder_level_milli', 'purchase_rate_paisa', 'sale_rate_paisa',
      'tax_pct_milli', 'show_public_price', 'public_price_paisa', 'availability_mode',
      'is_published', 'is_featured', 'is_active', 'seo_title', 'seo_description', 'season'
    ]);
    const boolCols = new Set(['track_batch','track_expiry','is_pesticide','show_public_price','is_published','is_featured','is_active']);
    const sets: string[] = []; const args: unknown[] = [];
    for (const [k, val] of Object.entries(body)) {
      if (k === 'slug') continue;
      if (!ALLOWED_UPDATE_COLS.has(k)) continue;
      if (k === 'category_id' && (!val || !String(val).trim())) continue;
      sets.push(`${k}=?`);
      let cleanVal: unknown = val;
      if (k === 'description_ur' || k === 'description_en') cleanVal = sanitizeHtml(String(val ?? ''));
      else if (boolCols.has(k)) cleanVal = val ? 1 : 0;
      else if (k === 'brand_id') cleanVal = (!val || val === '—') ? null : val;
      args.push(cleanVal);
    }
    if (body.slug) { const s = await uniqueSlug(db, body.slug, id); sets.push('slug=?'); args.push(s); }
    sets.push('updated_at=?', 'version=version+1'); args.push(nowIso());
    args.push(id, expectedVersion);
    const r = await db.prepare(`UPDATE products SET ${sets.join(',')} WHERE id=? AND version=?`).bind(...args).run();
    if (r.changes !== 1) {
      const current = await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first<any>();
      throw new BizError(409, 'VERSION_CONFLICT',
        'کسی اور نے بھی یہ ریکارڈ تبدیل کیا ہے — تازہ ترین معلومات دیکھ کر دوبارہ کوشش کریں',
        'This record changed elsewhere — reload the latest values and try again', undefined, current ?? before);
    }
    await audit(db, 'UPDATE', 'products', id, { user_id: me(c).id, before, after: body });
    await purgePublicCache();
    return ok(c, { id, version: expectedVersion + 1 });
  }));

  app.post('/api/v1/products/:id/publish', requirePerm('products.publish'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const body = await c.req.json() as { published?: boolean };
    const published = body.published !== false ? 1 : 0;
    await db.prepare('UPDATE products SET is_published=?,updated_at=?,version=version+1 WHERE id=?')
      .bind(published, nowIso(), c.req.param('id')).run();
    await audit(db, published ? 'PUBLISH' : 'UNPUBLISH', 'products', c.req.param('id'), { user_id: me(c).id });
    await purgePublicCache();
    return ok(c, { id: c.req.param('id'), is_published: !!published });
  }));

  app.post('/api/v1/products/bulk', requirePerm('products.publish'), (c) => handle(c, async () => {
    const body = await c.req.json() as { ids?: string[]; action?: string };
    if (!body.ids?.length || body.ids.length > 100) throw new BizError(400, 'INVALID_BULK', 'غلط درخواست', 'Invalid bulk request');
    const db = c.get('db')!;
    const field = body.action === 'publish' ? 'is_published=1' : body.action === 'unpublish' ? 'is_published=0'
      : body.action === 'activate' ? 'is_active=1' : body.action === 'deactivate' ? 'is_active=0' : null;
    if (!field) throw new BizError(400, 'INVALID_ACTION', 'نامعلوم عمل', 'Unknown bulk action');
    await db.batch(body.ids.map((id) => db.prepare(`UPDATE products SET ${field},updated_at=?,version=version+1 WHERE id=?`).bind(nowIso(), id)));
    await audit(db, 'BULK', 'products', null, { user_id: me(c).id, after: body });
    await purgePublicCache();
    return ok(c, { updated: body.ids.length });
  }));

  // Registered on a distinct path so it cannot be captured by GET /products/:id.
  app.get('/api/v1/catalogue/export', requirePerm('reports.export'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`${PUBLIC_SELECT} ORDER BY p.created_at DESC LIMIT 1000`).all<any>();
    const csv = toCsv(rows.map((r) => ({
      name_ur: r.name_ur, name_en: r.name_en, sku: r.sku, category_ur: r.category_ur,
      base_unit: r.base_unit, conversion_ratio_milli: r.conversion_ratio_milli,
      purchase_rate_paisa: r.purchase_rate_paisa, sale_rate_paisa: r.sale_rate_paisa,
      public_price_paisa: r.public_price_paisa, is_published: r.is_published, stock_milli: r.stock_milli,
    })));
    return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="zt-products.csv"' } });
  }));

  // CSV import: preview (no writes) then confirm (one atomic batch).
  app.post('/api/v1/import/products/preview', requirePerm('products.import'), (c) => handle(c, async () => {
    const { rows } = importSchema.parse(await c.req.json());
    const db = c.get('db')!;
    const report: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const errors: string[] = [];
      const name = String(r.name_ur ?? r['name_ur'] ?? '').trim();
      const category = String(r.category_code ?? r['category_code'] ?? '').trim().toUpperCase();
      if (!name) errors.push('name_ur required');
      if (!category) errors.push('category_code required');
      const cat = category ? await db.prepare('SELECT id FROM product_categories WHERE code=? OR slug=?').bind(category, category.toLowerCase()).first() : null;
      if (category && !cat) errors.push('unknown category');
      const sku = String(r.sku ?? '').trim();
      let duplicate: string | null = null;
      if (sku) duplicate = (await db.prepare('SELECT id FROM products WHERE sku=?').bind(sku).first<{ id: string }>())?.id ?? null;
      if (!duplicate && name) duplicate = (await db.prepare('SELECT id FROM products WHERE name_ur=?').bind(name).first<{ id: string }>())?.id ?? null;
      let conversion = 1000;
      let purchasePaisa = 0, salePaisa = 0;
      try {
        if (r.conversion_ratio) conversion = toMilli(String(r.conversion_ratio));
        if (r.purchase_rate) purchasePaisa = rupeesToPaisa(String(r.purchase_rate));
        if (r.sale_rate) salePaisa = rupeesToPaisa(String(r.sale_rate));
      } catch { errors.push('invalid numeric value'); }
      report.push({ row: i + 1, name_ur: name, category, sku, duplicate_id: duplicate, errors,
        data: { name_ur: name, name_en: String(r.name_en ?? ''), category_id: cat?.id, sku,
          base_unit: String(r.base_unit ?? 'kg'), purchase_rate_paisa: purchasePaisa,
          sale_rate_paisa: salePaisa, conversion_ratio_milli: conversion } });
    }
    return ok(c, { rows: report, valid: report.filter((r) => !r.errors.length).length,
      duplicates: report.filter((r) => r.duplicate_id).length });
  }));

  app.post('/api/v1/import/products/confirm', requirePerm('products.import'), (c) => handle(c, async () => {
    const body = await c.req.json() as { rows?: any[]; mode?: 'SKIP' | 'UPDATE' };
    if (!body.rows?.length) throw new BizError(400, 'NO_ROWS', 'کوئی قطار نہیں', 'No rows');
    const db = c.get('db')!; const at = nowIso();
    let created = 0, updated = 0, skipped = 0;
    const stmts: any[] = [];
    for (const r of body.rows) {
      if (r.errors?.length) { skipped++; continue; }
      if (r.duplicate_id && body.mode !== 'UPDATE') { skipped++; continue; }
      const d = r.data;
      if (r.duplicate_id) {
        stmts.push(db.prepare('UPDATE products SET name_ur=?,sale_rate_paisa=?,purchase_rate_paisa=?,updated_at=?,version=version+1 WHERE id=?')
          .bind(d.name_ur, d.sale_rate_paisa, d.purchase_rate_paisa, at, r.duplicate_id));
        updated++;
      } else {
        const id = ulid(); const slug = await uniqueSlug(db, d.name_ur);
        stmts.push(db.prepare(`INSERT INTO products (id,name_ur,name_en,slug,category_id,sku,base_unit,purchase_unit,sale_unit,
          conversion_ratio_milli,purchase_rate_paisa,sale_rate_paisa,is_published,is_active,created_at,created_by,updated_at,version)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?,?,1)`).bind(
          id, d.name_ur, d.name_en, slug, d.category_id, d.sku, d.base_unit, d.base_unit, d.base_unit,
          d.conversion_ratio_milli, d.purchase_rate_paisa, d.sale_rate_paisa, at, me(c).id, at));
        created++;
      }
    }
    if (stmts.length) await db.batch(stmts);
    await audit(db, 'IMPORT', 'products', null, { user_id: me(c).id, after: { created, updated, skipped } });
    await purgePublicCache();
    return ok(c, { created, updated, skipped, import_log: { created, updated, skipped, at } });
  }));

  // --------------------------- categories / brands ----------------------------
  app.get('/api/v1/categories', requirePerm('catalogue.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM product_categories WHERE deleted=0 ORDER BY sort,name_ur LIMIT 100').all())));
  app.post('/api/v1/categories', requirePerm('catalogue.write', 'products.write'), (c) => handle(c, async () => {
    const body = categorySchema.parse(await c.req.json());
    const db = c.get('db')!; const id = ulid(); const at = nowIso();
    await db.prepare(`INSERT INTO product_categories (id,code,parent_id,name_ur,name_en,slug,book_code,icon,sort,is_active,is_system,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1)`).bind(id, body.code, body.parent_id ?? null, body.name_ur,
      body.name_en, body.slug, body.book_code ?? null, body.icon ?? '', body.sort, body.is_active ? 1 : 0, at, at).run();
    await audit(db, 'CREATE', 'product_categories', id, { user_id: me(c).id });
    await purgePublicCache();
    return ok(c, { id }, 201);
  }));
  app.put('/api/v1/categories/:id', requirePerm('catalogue.write'), (c) => handle(c, async () => {
    const body = await c.req.json() as Record<string, unknown>;
    const db = c.get('db')!;
    const id = c.req.param('id');
    const before = await assertRowVersion(db, 'product_categories', 'id', id, body.base_version);
    if (!before) return fail(c, 404, 'NOT_FOUND', 'زمرہ نہیں ملا', 'Category not found');
    const allowed = ['name_ur','name_en','slug','icon','sort','is_active'];
    const sets: string[] = []; const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) if (allowed.includes(k)) { sets.push(`${k}=?`); args.push(v); }
    sets.push('updated_at=?', 'version=version+1'); args.push(nowIso());
    args.push(id, before.version);
    const r = await db.prepare(`UPDATE product_categories SET ${sets.join(',')} WHERE id=? AND version=?`).bind(...args).run();
    if (r.changes !== 1) {
      const current = await db.prepare('SELECT * FROM product_categories WHERE id=?').bind(id).first<any>();
      throw new BizError(409, 'VERSION_CONFLICT',
        'کسی اور نے بھی یہ زمرہ تبدیل کیا ہے — دوبارہ لوڈ کریں',
        'This category changed elsewhere — reload', undefined, current ?? before);
    }
    await audit(db, 'UPDATE', 'product_categories', id, { user_id: me(c).id, before, after: body });
    await purgePublicCache();
    return ok(c, { id, version: before.version + 1 });
  }));
  app.get('/api/v1/brands', requirePerm('catalogue.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM brands WHERE deleted=0 ORDER BY name_ur LIMIT 200').all())));
  app.post('/api/v1/brands', requirePerm('catalogue.write', 'products.write'), (c) => handle(c, async () => {
    const body = brandSchema.parse(await c.req.json());
    const db = c.get('db')!; const id = ulid();
    await db.prepare('INSERT INTO brands (id,name_ur,name_en,is_active,created_at,updated_at,version) VALUES (?,?,?,?,?,?,1)')
      .bind(id, body.name_ur, body.name_en, body.is_active ? 1 : 0, nowIso(), nowIso()).run();
    return ok(c, { id }, 201);
  }));
  app.get('/api/v1/units', requirePerm('catalogue.read'), (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM unit_conversions WHERE deleted=0 ORDER BY from_unit LIMIT 200').all())));
  app.post('/api/v1/units', requirePerm('catalogue.write'), (c) => handle(c, async () => {
    const body = await c.req.json() as { from_unit: string; to_unit: string; ratio_milli: number; confirmed?: boolean };
    const db = c.get('db')!;
    await db.prepare(`INSERT INTO unit_conversions (id,from_unit,to_unit,ratio_milli,confirmed,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,1) ON CONFLICT(from_unit,to_unit) DO UPDATE SET ratio_milli=excluded.ratio_milli,
        confirmed=excluded.confirmed, updated_at=excluded.updated_at, version=unit_conversions.version+1`)
      .bind(ulid(), body.from_unit, body.to_unit, body.ratio_milli, body.confirmed ? 1 : 0, nowIso(), nowIso()).run();
    return ok(c, { ok: true }, 201);
  }));

  // ---------------------------------- images ----------------------------------
  app.post('/api/v1/images', requirePerm('products.write'), (c) => handle(c, async () => {
    const body = await c.req.json() as any;
    const db = c.get('db')!;
    if (Array.isArray(body.images) && body.images.length > 0) {
      const results: any[] = [];
      for (let idx = 0; idx < body.images.length; idx++) {
        const img = body.images[idx];
        const match = /^data:image\/(webp|jpeg|png|avif);base64,([A-Za-z0-9+/=]+)$/.exec(img.data_url ?? '');
        if (!match) continue;
        const bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
        if (bytes.length > 10 * 1024 * 1024) continue;
        const key = `products/${body.product_id}/${ulid()}.${match[1]}`;
        await putMedia(c, key, bytes);
        const imgId = ulid();
        await db.prepare(`INSERT INTO product_images (id,product_id,r2_key,alt_ur,sort,is_primary,created_at)
          VALUES (?,?,?,?,?,?,?)`).bind(imgId, body.product_id, key, img.alt_ur ?? '', idx, (idx === 0 && img.is_primary) ? 1 : 0, nowIso()).run();
        results.push({ id: imgId, url: `/media/${key}` });
      }
      await purgePublicCache();
      return ok(c, { ok: true, count: results.length, images: results }, 201);
    }
    const match = /^data:image\/(webp|jpeg|png|avif);base64,([A-Za-z0-9+/=]+)$/.exec(body.data_url ?? '');
    if (!match) throw new BizError(400, 'INVALID_IMAGE', 'تصویر کا فارمیٹ درست نہیں', 'Only WebP/JPEG/PNG/AVIF data URLs');
    const bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
    if (bytes.length > 10 * 1024 * 1024) throw new BizError(413, 'IMAGE_TOO_LARGE', 'تصویر 10 ایم بی سے بڑی ہے', 'Image exceeds 10 MB');
    const key = `products/${body.product_id}/${ulid()}.${match[1]}`;
    await putMedia(c, key, bytes);
    const id = ulid();
    await db.prepare(`INSERT INTO product_images (id,product_id,r2_key,alt_ur,sort,is_primary,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(id, body.product_id, key, body.alt_ur ?? '', 0, body.is_primary ? 1 : 0, nowIso()).run();
    await purgePublicCache();
    return ok(c, { id, url: `/media/${key}` }, 201);
  }));

  app.delete('/api/v1/images/:id', requirePerm('products.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    await db.prepare('DELETE FROM product_images WHERE id=?').bind(c.req.param('id')).run();
    await purgePublicCache();
    return ok(c, { deleted: true });
  }));

  app.get('/media/:key{.+}', async (c) => {
    const key = c.req.param('key');
    if (key.includes('..')) return c.text('bad key', 400);
    const found = await getMedia(c, key);
    if (!found) return c.text('not found', 404);
    return c.body(found.body, 200, { 'Content-Type': found.mime, 'Cache-Control': 'public, max-age=86400' });
  });
}
