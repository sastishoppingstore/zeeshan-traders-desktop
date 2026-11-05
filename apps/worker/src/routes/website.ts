/** Website CMS, enquiry inbox, sitemap.xml / robots.txt generated from the DB. */
import type { Hono } from 'hono';
import type { AppEnv, AppVars } from '../context.js';
import { ok, fail, handle, me, audit, nowIso, requirePerm, purgePublicCache, BizError } from '../context.js';
import { cmsPageSchema, bannerSchema, announcementSchema, ulid } from '@zt/shared';
import { sanitizeHtml } from './catalogue.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

export function registerWebsite(app: H) {
  app.get('/api/v1/website/pages', (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM website_pages ORDER BY slug').all())));

  app.put('/api/v1/website/pages/:slug', requirePerm('cms.write'), (c) => handle(c, async () => {
    const body = cmsPageSchema.parse(await c.req.json());
    const db = c.get('db')!;
    const before = await db.prepare('SELECT * FROM website_pages WHERE slug=?').bind(c.req.param('slug')).first<any>();
    await db.prepare(`INSERT INTO website_pages (slug,title_ur,title_en,body_ur,body_en,status,created_at,updated_at,updated_by,version)
      VALUES (?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(slug) DO UPDATE SET title_ur=excluded.title_ur,title_en=excluded.title_en,
        body_ur=excluded.body_ur,body_en=excluded.body_en,status=excluded.status,
        updated_at=excluded.updated_at,updated_by=excluded.updated_by,version=website_pages.version+1`)
      .bind(body.slug, body.title_ur, body.title_en,
        sanitizeHtml(body.body_ur), sanitizeHtml(body.body_en), body.status,
        nowIso(), nowIso(), me(c).id).run();
    await audit(db, 'UPDATE', 'website_pages', body.slug, { user_id: me(c).id, before, after: body });
    await purgePublicCache();
    return ok(c, { slug: body.slug, status: body.status });
  }));

  app.get('/api/v1/website/banners', (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM website_banners ORDER BY sort LIMIT 100').all())));
  app.post('/api/v1/website/banners', requirePerm('cms.write'), (c) => handle(c, async () => {
    const body = bannerSchema.parse(await c.req.json());
    const db = c.get('db')!; const id = ulid();
    await db.prepare(`INSERT INTO website_banners (id,title_ur,image_r2_key,sort,is_active,active_from,active_to,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,1)`).bind(id, body.title_ur, body.image_r2_key, body.sort,
      body.is_active ? 1 : 0, body.active_from ?? null, body.active_to ?? null, nowIso(), nowIso()).run();
    await purgePublicCache();
    return ok(c, { id }, 201);
  }));

  app.get('/api/v1/website/announcements', (c) => handle(c, async () =>
    ok(c, await c.get('db')!.prepare('SELECT * FROM website_announcements ORDER BY publish_at DESC LIMIT 100').all())));
  app.post('/api/v1/website/announcements', requirePerm('cms.write'), (c) => handle(c, async () => {
    const body = announcementSchema.parse(await c.req.json());
    const db = c.get('db')!; const id = ulid();
    await db.prepare(`INSERT INTO website_announcements (id,title_ur,body_ur,publish_at,is_active,created_at,updated_at,created_by,version)
      VALUES (?,?,?,?,?,?,?,?,1)`).bind(id, body.title_ur, sanitizeHtml(body.body_ur), body.publish_at,
      body.is_active ? 1 : 0, nowIso(), nowIso(), me(c).id).run();
    await purgePublicCache();
    return ok(c, { id }, 201);
  }));

  app.post('/api/v1/website/publish', requirePerm('cms.write'), (c) => handle(c, async () => {
    await purgePublicCache();
    await audit(c.get('db')!, 'PUBLISH', 'website', null, { user_id: me(c).id });
    return ok(c, { published: true, cache_purged: true });
  }));

  // --------------------------------- Enquiries --------------------------------
  app.get('/api/v1/enquiries', requirePerm('enquiries.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare('SELECT * FROM website_enquiries ORDER BY created_at DESC LIMIT 100').all<any>();
    const items = await db.prepare('SELECT * FROM website_enquiry_items LIMIT 500').all<any>();
    return ok(c, rows.map((r) => ({ ...r, items: items.filter((i) => i.enquiry_id === r.id) })));
  }));
  app.get('/api/v1/enquiries/:id', requirePerm('enquiries.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const row = await db.prepare('SELECT * FROM website_enquiries WHERE id=?').bind(c.req.param('id')).first<any>();
    if (!row) return fail(c, 404, 'NOT_FOUND', 'پوچھ گچھ نہیں ملی', 'Enquiry not found');
    const items = await db.prepare('SELECT * FROM website_enquiry_items WHERE enquiry_id=?').bind(row.id).all();
    return ok(c, { ...row, items });
  }));
  app.post('/api/v1/enquiries/:id/status', requirePerm('enquiries.write'), (c) => handle(c, async () => {
    const body = await c.req.json() as { status?: string; reason?: string };
    const allowed = ['NEW', 'REVIEW', 'APPROVED', 'REJECTED', 'CONVERTED'];
    if (!body.status || !allowed.includes(body.status)) throw new BizError(400, 'INVALID_STATUS', 'غلط حالت', 'Invalid status');
    if (body.status === 'REJECTED' && !body.reason) throw new BizError(400, 'REASON_REQUIRED', 'مسترد کرنے کی وجہ درکار ہے', 'Reason required');
    const db = c.get('db')!;
    await db.prepare('UPDATE website_enquiries SET status=?,reject_reason=?,updated_at=?,version=version+1 WHERE id=?')
      .bind(body.status, body.reason ?? null, nowIso(), c.req.param('id')).run();
    await audit(db, 'STATUS', 'website_enquiries', c.req.param('id'), { user_id: me(c).id, after: body });
    return ok(c, { id: c.req.param('id'), status: body.status });
  }));
  app.post('/api/v1/enquiries/:id/quotation', requirePerm('enquiries.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const id = c.req.param('id');
    const enquiry = await db.prepare('SELECT * FROM website_enquiries WHERE id=?').bind(id).first<any>();
    if (!enquiry) return fail(c, 404, 'NOT_FOUND', 'پوچھ گچھ نہیں ملی', 'Enquiry not found');
    const items = await db.prepare('SELECT * FROM website_enquiry_items WHERE enquiry_id=?').bind(id).all<any>();
    const seq = await db.prepare('SELECT next_value FROM invoice_sequences WHERE code=?').bind('QUOTATION').first<any>();
    const number = `QT-${new Date().getUTCFullYear()}-${String(seq?.next_value ?? 1).padStart(6, '0')}`;
    const qid = ulid(); const at = nowIso();
    const stmts: any[] = [
      db.prepare('UPDATE invoice_sequences SET next_value=next_value+1 WHERE code=?').bind('QUOTATION'),
      db.prepare(`INSERT INTO quotations (id,number,enquiry_id,party_id,date,total_paisa,status,snapshot_json,created_at,created_by)
        VALUES (?,?,?,NULL,date('now'),0,'DRAFT',?,?,?)`).bind(qid, number, id, JSON.stringify({ enquiry, items }), at, me(c).id),
      db.prepare("UPDATE website_enquiries SET status='CONVERTED',ref_type='QUOTATION',ref_id=?,updated_at=?,version=version+1 WHERE id=?").bind(qid, at, id),
    ];
    for (const item of items) {
      stmts.push(db.prepare('INSERT INTO quotation_items (id,quotation_id,product_id,qty_milli,rate_paisa) VALUES (?,?,?,?,0)')
        .bind(ulid(), qid, item.product_id, item.qty_milli));
    }
    await db.batch(stmts);
    return ok(c, { id: qid, number }, 201);
  }));

  // ------------------------- SEO: sitemap.xml / robots.txt --------------------
  app.get('/sitemap.xml', async (c) => {
    const db = c.get('db')!;
    const origin = new URL(c.req.url).origin;
    const products = await db.prepare('SELECT slug,updated_at FROM products WHERE deleted=0 AND is_published=1 AND is_active=1 ORDER BY created_at DESC LIMIT 2000').all<any>();
    const categories = await db.prepare('SELECT slug FROM product_categories WHERE is_active=1 AND deleted=0 LIMIT 100').all<any>();
    const pages = await db.prepare("SELECT slug FROM website_pages WHERE status='PUBLISHED' LIMIT 50").all<any>();
    const urls = [
      '/', '/products', ...categories.map((x) => `/category/${x.slug}`),
      ...products.map((x) => `/product/${x.slug}`),
      ...pages.map((x) => `/${x.slug}`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${origin}${u}</loc><changefreq>daily</changefreq></url>`).join('\n') +
      '\n</urlset>';
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  });
  app.get('/robots.txt', async (c) => {
    const origin = new URL(c.req.url).origin;
    return c.text(`User-agent: *\nAllow: /\nDisallow: /erp\nDisallow: /api/v1\nSitemap: ${origin}/sitemap.xml\n`, 200,
      { 'Cache-Control': 'public, max-age=86400' });
  });

  // ------------------------- AI Agent Discovery: llms.txt & ARD manifest -------
  app.get('/llms.txt', async (c) => {
    const origin = new URL(c.req.url).origin;
    const body = `# Zeeshan Traders

> Agricultural dealership located at Maqsood Chowk, District Layyah, Punjab, Pakistan. Serving farmers and traders with certified fertilizers, pesticides, seeds, animal feeds, cement, and grains.

## Main Resources
- [Home](${origin}/): Storefront with product showcases, rates, and business information
- [Products](${origin}/products): Catalogue of fertilizers, seeds, choker, wanda, cement, and grains
- [Categories](${origin}/categories): Directory of all agricultural departments
- [Public API](${origin}/api/v1/public/products): Public REST API endpoint for catalogue
- [Enquiry](${origin}/enquiry): Order and rate inquiry form
- [Contact](${origin}/contact): Location details, WhatsApp, and phone contacts
`;
    return c.text(body, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
  });

  app.get('/.well-known/ard.json', async (c) => {
    const origin = new URL(c.req.url).origin.includes('localhost') ? 'https://zeeshantraders.store' : new URL(c.req.url).origin;
    const host = new URL(origin).hostname;
    const manifest = {
      $schema: 'https://agenticresource.org/schemas/ard-v1.json',
      name: 'Zeeshan Traders',
      description: 'Zeeshan Traders — Agricultural inputs and commodities dealership at Maqsood Chowk, District Layyah, Punjab, Pakistan',
      url: origin,
      entries: [
        {
          identifier: `urn:air:${host}:api:products`,
          displayName: 'Zeeshan Traders Products API',
          type: 'application/json',
          url: `${origin}/api/v1/public/products`,
          description: 'Real-time catalogue API for agricultural inputs (fertilizer, pesticides, seeds, cement, grains) with verified prices and availability.',
          tags: ['agriculture', 'fertilizer', 'pesticides', 'seeds', 'cement', 'grains', 'pricing'],
          capabilities: ['product-search', 'pricing', 'stock-availability'],
          representativeQueries: [
            'What is the current price of Urea and DAP fertilizer at Zeeshan Traders?',
            'Check available pesticide brands and stock at Maqsood Chowk.',
            'List all agricultural seeds and wheat grain rates.'
          ]
        },
        {
          identifier: `urn:air:${host}:web:catalogue`,
          displayName: 'Online Product Catalogue',
          type: 'text/html',
          url: `${origin}/products`,
          description: 'Interactive online store, commodity board, and direct agricultural supply ordering.',
          tags: ['catalogue', 'store', 'ecommerce', 'agri-supplies'],
          representativeQueries: [
            'Browse fertilizer and seed products online.',
            'Order agricultural supplies from Zeeshan Traders.'
          ]
        },
        {
          identifier: `urn:air:${host}:web:contact`,
          displayName: 'WhatsApp & Direct Dealership Support',
          type: 'text/html',
          url: `${origin}/contact`,
          description: 'Dealership location at Maqsood Chowk, Layyah and direct WhatsApp and phone contacts.',
          tags: ['contact', 'support', 'location', 'layyah'],
          representativeQueries: [
            'Where is Zeeshan Traders located in Layyah?',
            'How can I contact Zeeshan Traders on WhatsApp?'
          ]
        }
      ],
      resources: [
        { name: 'Products API', type: 'api', url: `${origin}/api/v1/public/products` },
        { name: 'Catalogue', type: 'webpage', url: `${origin}/products` },
        { name: 'Categories', type: 'webpage', url: `${origin}/categories` },
      ],
    };
    return c.json(manifest, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
  });
}
