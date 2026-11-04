/** Social card rewriting for crawlers: absolute URLs on the shell, product data on /product/:slug. */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeHarness, createProduct, type Harness } from './helpers.js';
import { makeDb } from '../apps/worker/src/context.js';
import { socialHtml } from '../apps/worker/src/services/social.js';

const SHELL = `<meta property="og:type" content="website" />
<meta property="og:site_name" content="ذیشان ٹریڈرز" />
<meta property="og:title" content="ذیشان ٹریڈرز | Zeeshan Traders" />
<meta property="og:description" content="کھاد، پیسٹی سائیڈ، بیج، سیمنٹ اور اجناس" />
<meta property="og:image" content="/og/og-1200x630.jpg" />
<meta property="og:image:alt" content="ذیشان ٹریڈرز کا اسٹور" />
<meta property="og:url" content="/" />
<meta name="twitter:title" content="ذیشان ٹریڈرز | Zeeshan Traders" />
<meta name="twitter:description" content="کھاد، پیسٹی سائیڈ، بیج، سیمنٹ اور اجناس" />
<meta name="twitter:image" content="/og/og-1200x630.jpg" />`;
const attr = (html: string, key: string) =>
  new RegExp(`<(?:meta)[^>]*(?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];

describe('socialHtml (real SQL)', () => {
  let h: Harness;
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    h = makeHarness();
    await h.setup();
    db = makeDb(h.env);
  });

  it('S1 makes crawler URLs absolute on the plain shell', async () => {
    const out = await socialHtml(db, 'https://zt.example.workers.dev', '/', SHELL);
    expect(attr(out, 'og:url')).toBe('https://zt.example.workers.dev/');
    expect(attr(out, 'og:image')).toBe('https://zt.example.workers.dev/og/og-1200x630.jpg');
    expect(attr(out, 'twitter:image')).toBe('https://zt.example.workers.dev/og/og-1200x630.jpg');
    expect(attr(out, 'og:title')).toBe('ذیشان ٹریڈرز | Zeeshan Traders');
  });

  it('S2 a published product gets its own title, price and uploaded photo', async () => {
    const p = await createProduct(h, { name_ur: 'یوریا 50 کلو', name_en: 'Urea 50kg',
      public_price_paisa: 456_500, is_published: true });
    await h.sqlite.prepare('INSERT INTO product_images (id,product_id,r2_key,alt_ur,sort,is_primary,created_at) VALUES (?,?,?,?,0,1,?)')
      .run('img-' + p.id, p.id, 'products/product-urea.webp', 'یوریا', '2026-11-04T00:00:00.000Z');
    const out = await socialHtml(db, 'https://zt.example', `/product/${p.slug}`, SHELL);
    expect(attr(out, 'og:title')).toContain('یوریا 50 کلو');
    expect(attr(out, 'og:description')).toContain('Rs 4,565');
    expect(attr(out, 'og:image')).toBe('https://zt.example/media/products/product-urea.webp');
  });

  it('S3 an unpublished product leaves the shell card untouched', async () => {
    const p = await createProduct(h, { name_ur: 'پرائیویٹ', is_published: false });
    const out = await socialHtml(db, 'https://zt.example', `/product/${p.slug}`, SHELL);
    expect(attr(out, 'og:image')).toBe('https://zt.example/og/og-1200x630.jpg');
    expect(attr(out, 'og:title')).toBe('ذیشان ٹریڈرز | Zeeshan Traders');
  });

  it('S4 a price-on-call product never invents a figure in the card', async () => {
    const p = await createProduct(h, { name_ur: 'این پی کے', name_en: 'NPK', show_public_price: false, is_published: true });
    const out = await socialHtml(db, 'https://zt.example', `/product/${p.slug}`, SHELL);
    expect(attr(out, 'og:description')).toContain('قیمت کے لیے رابطہ کریں');
    expect(attr(out, 'og:description')).not.toMatch(/Rs|₨|[0-9],[0-9]{3}/);
  });

  it('S5 a quote or tag in the product name cannot break out of the meta attribute', async () => {
    const p = await createProduct(h, { name_ur: 'X" onload="alert(1)<b>', name_en: 'X', is_published: true });
    const out = await socialHtml(db, 'https://zt.example', `/product/${p.slug}`, SHELL);
    expect(out).not.toContain('content="X" onload');
    expect(out).toContain('&quot;');
    expect(out.match(/content="/g)!.length).toBe((SHELL.match(/content="/g) ?? []).length);
  });
});
