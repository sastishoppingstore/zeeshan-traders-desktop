/**
 * Generates seed/catalogue-staging.sql — SAMPLE catalogue for the staging D1 only.
 *
 * Every product photo the shop owns becomes one catalogue row, so the site never renders an empty
 * tile. Prices come from publicly listed Pakistan market rates collected 3-4 Nov 2026 and are
 * reference figures the owner must confirm; items without a sourced rate are published as
 * "price on call" (show_public_price=0) rather than given an invented number, and checkout refuses
 * those lines with PRICE_ON_CALL. Purchase rates are left at 0 — costs are the owner's real
 * purchases, never seeded.
 *
 * Production gets NOTHING from this file (spec H8): the production catalogue stays empty until the
 * owner enters their own stock and rates.
 *
 * Run: node scripts/seed-catalogue.mjs
 * Apply (staging only): npx wrangler d1 execute zt-staging --remote --env staging --file=seed/catalogue-staging.sql
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const NOW = '2026-11-04T00:00:00.000Z';
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const P = (rs) => Math.round(rs * 100);

/** rate = published PKR per base unit, or null for price-on-call. opening = qty in base units.
 *  name_en must START with its photo token — productMedia() returns the first token that hits PRODUCT_TOKEN_MEDIA. */
const PRODUCTS = [
  // ---- fertilizer (bag = 50 kg) ----
  { key: 'pseed-urea', ur: 'یوریا (50 کلو بوری)', en: 'Urea 50kg', cat: 'cat-fert', unit: 'bag', grams: 50000, rate: 4565, opening: 200, featured: 1 },
  { key: 'pseed-dap', ur: 'ڈی اے پی کھاد (50 کلو)', en: 'DAP 50kg', cat: 'cat-fert', unit: 'bag', grams: 50000, rate: 16500, opening: 120, featured: 1 },
  { key: 'pseed-npk', ur: 'این پی کے 20-20-20 (50 کلو)', en: 'NPK 20-20-20 50kg', cat: 'cat-fert', unit: 'bag', grams: 50000, rate: null, opening: 100 },
  // ---- cement (bag = 50 kg) ----
  { key: 'pseed-cement-lucky', ur: 'لکی سیمنٹ (50 کلو)', en: 'Lucky Cement 50kg', cat: 'cat-cem', unit: 'bag', grams: 50000, rate: 1550, opening: 400, featured: 1 },
  { key: 'pseed-cement-maple', ur: 'میپل لیف سیمنٹ (50 کلو)', en: 'Maple Leaf Cement 50kg', cat: 'cat-cem', unit: 'bag', grams: 50000, rate: 1560, opening: 300 },
  // ---- grains (maund = 40 kg) ----
  { key: 'pseed-wheat', ur: 'گندم (40 کلو منہ)', en: 'Wheat 40kg', cat: 'cat-wheat', unit: 'maund', grams: 40000, rate: 4200, opening: 500, featured: 1 },
  { key: 'pseed-wheat-local', ur: 'لوکل گندم (40 کلو)', en: 'Local Wheat 40kg', cat: 'cat-wheat', unit: 'maund', grams: 40000, rate: null, opening: 200 },
  { key: 'pseed-wheat-super', ur: 'سپر گریڈ گندم (40 کلو)', en: 'Super Grade Wheat 40kg', cat: 'cat-wheat', unit: 'maund', grams: 40000, rate: null, opening: 150 },
  { key: 'pseed-wheat-sill', ur: 'سِل بیج گندم (40 کلو)', en: 'Sill Wheat Seed 40kg', cat: 'cat-wheat', unit: 'maund', grams: 40000, rate: null, opening: 100 },
  { key: 'pseed-wheat-durum', ur: 'درم گندم (40 کلو)', en: 'Durum Wheat 40kg', cat: 'cat-wheat', unit: 'maund', grams: 40000, rate: null, opening: 60 },
  { key: 'pseed-paddy', ur: 'مونجی / دھان (40 کلو)', en: 'Paddy 40kg', cat: 'cat-rice', unit: 'maund', grams: 40000, rate: 2650, opening: 400 },
  { key: 'pseed-rice-basmati', ur: 'بسمتی سپر چاول (40 کلو)', en: 'Basmati Super Rice 40kg', cat: 'cat-rice', unit: 'maund', grams: 40000, rate: null, opening: 120 },
  { key: 'pseed-rice-sella', ur: 'سیلا چاول (40 کلو)', en: 'Sella Rice 40kg', cat: 'cat-rice', unit: 'maund', grams: 40000, rate: null, opening: 100 },
  { key: 'pseed-sesame', ur: 'تل (40 کلو)', en: 'Sesame 40kg', cat: 'cat-sesame', unit: 'maund', grams: 40000, rate: null, opening: 80 },
  { key: 'pseed-sesame-tolai', ur: 'تولی تل (40 کلو)', en: 'Tolai Sesame 40kg', cat: 'cat-sesame', unit: 'maund', grams: 40000, rate: null, opening: 60 },
  { key: 'pseed-sesame-black', ur: 'کالی تل (40 کلو)', en: 'Black Sesame 40kg', cat: 'cat-sesame', unit: 'maund', grams: 40000, rate: null, opening: 40 },
  { key: 'pseed-bajra', ur: 'باجرہ (40 کلو)', en: 'Bajra Millet 40kg', cat: 'cat-millet', unit: 'maund', grams: 40000, rate: 3800, opening: 150 },
  { key: 'pseed-maize', ur: 'مکئی (40 کلو)', en: 'Maize 40kg', cat: 'cat-maize', unit: 'maund', grams: 40000, rate: 3100, opening: 250 },
  { key: 'pseed-moong', ur: 'مونگ (40 کلو)', en: 'Moong Bean 40kg', cat: 'cat-moong', unit: 'maund', grams: 40000, rate: 8000, opening: 90 },
  { key: 'pseed-mustard', ur: 'سرسوں بیج (40 کلو)', en: 'Mustard Seed 40kg', cat: 'cat-mustard', unit: 'maund', grams: 40000, rate: null, opening: 70 },
  // ---- wandas / choker / cattle ----
  { key: 'pseed-wanda', ur: 'ونڈا (40 کلو)', en: 'Wanda 40kg', cat: 'cat-wand', unit: 'maund', grams: 40000, rate: null, opening: 100 },
  { key: 'pseed-wanda-chuni', ur: 'چھنی ونڈا (40 کلو)', en: 'Chuni Wanda 40kg', cat: 'cat-wand', unit: 'maund', grams: 40000, rate: null, opening: 80 },
  { key: 'pseed-bran', ur: 'چوکر (40 کلو)', en: 'Choker Wheat Bran 40kg', cat: 'cat-chok', unit: 'maund', grams: 40000, rate: null, opening: 120 },
  { key: 'pseed-bran-fine', ur: 'باریک چوکر (40 کلو)', en: 'Fine Bran 40kg', cat: 'cat-chok', unit: 'maund', grams: 40000, rate: null, opening: 90 },
  { key: 'pseed-bran-coarse', ur: 'موٹا چوکر (40 کلو)', en: 'Coarse Bran 40kg', cat: 'cat-chok', unit: 'maund', grams: 40000, rate: null, opening: 70 },
  { key: 'pseed-cotton-seed', ur: 'کپاس کا بیج (8 کلو)', en: 'Cotton Seed 8kg', cat: 'cat-seed', unit: 'bag', grams: 8000, rate: null, opening: 150 },
  { key: 'pseed-cattle-feed', ur: 'مویشی خوراک / ڈیمرا (50 کلو)', en: 'Cattle Feed 50kg', cat: 'cat-othr', unit: 'bag', grams: 50000, rate: null, opening: 100 },
  { key: 'pseed-cotton-khal', ur: 'کپاس کھلی (40 کلو)', en: 'Khal Cotton Cake 40kg', cat: 'cat-othr', unit: 'maund', grams: 40000, rate: null, opening: 60 },
  // ---- crop protection (bottle = litre) ----
  { key: 'pseed-insecticide', ur: 'کیڑے مار زہر (1 لیٹر)', en: 'Insecticide 1L', cat: 'cat-pest', unit: 'litter', grams: 1000, rate: null, opening: 60, pesticide: 1 },
  { key: 'pseed-pesticide', ur: 'عام کیڑے مار دوا (1 لیٹر)', en: 'Pesticide 1L', cat: 'cat-pest', unit: 'litter', grams: 1000, rate: null, opening: 50, pesticide: 1 },
  { key: 'pseed-fungicide', ur: 'فنگس مار دوا (1 لیٹر)', en: 'Fungicide 1L', cat: 'cat-pest', unit: 'litter', grams: 1000, rate: null, opening: 40, pesticide: 1 },
  { key: 'pseed-herbicide', ur: 'جڑی بوٹی مار (5 لیٹر کین)', en: 'Herbicide 5L', cat: 'cat-pest', unit: 'can', grams: 5000, rate: null, opening: 30, pesticide: 1 },
  // ---- tools / irrigation ----
  { key: 'pseed-sprayer', ur: 'پاور سپریر (16 لیٹر)', en: 'Sprayer 16L', cat: 'cat-othr', unit: 'piece', grams: 0, rate: null, opening: 12 },
  { key: 'pseed-irrigation', ur: 'نالی / پائپ (ریل)', en: 'Irrigation Pipe 100ft', cat: 'cat-othr', unit: 'roll', grams: 0, rate: null, opening: 25 },
];

const lines = [
  '-- GENERATED by scripts/seed-catalogue.mjs — STAGING SAMPLE DATA ONLY.',
  '-- Never apply this file to the production D1 (spec H8: the production catalogue starts empty).',
  '-- Prices are public market references collected 3-4 Nov 2026 and need the owner\'s confirmation.',
  '-- Items with no sourced rate are published as price-on-call, and purchase rates are left at 0.',
  '-- Opening stock is written as stock_movements + stock_balance so /integrity stays clean.',
  '',
];

for (const p of PRODUCTS) {
  const slug = p.key.replace(/^pseed-/, '');
  const price = p.rate === null ? 0 : P(p.rate);
  lines.push(
    `INSERT OR IGNORE INTO products (id,name_ur,name_en,slug,category_id,sku,base_unit,purchase_unit,sale_unit,` +
    `conversion_ratio_milli,grams_per_base_unit,track_batch,track_expiry,is_pesticide,reorder_level_milli,` +
    `purchase_rate_paisa,sale_rate_paisa,tax_pct_milli,show_public_price,public_price_paisa,availability_mode,` +
    `is_published,is_featured,is_active,season,created_at,updated_at) VALUES (` +
    [q(p.key), q(p.ur), q(p.en), q(slug), q(p.cat), q(`ST-${slug.toUpperCase()}`), q(p.unit), q(p.unit), q(p.unit),
      1000, p.grams, p.pesticide ? 1 : 0, p.pesticide ? 1 : 0, p.pesticide ? 1 : 0, 0,
      0, price, 0, p.rate === null ? 0 : 1, price, q(p.rate === null ? 'CALL' : 'AUTO'),
      1, p.featured ? 1 : 0, 1, q('NONE'), q(NOW), q(NOW)].join(',') + `);`,
  );
  // Opening stock: one movement + the cached balance it implies (integrity compares the two).
  const qty = p.opening * 1000;
  lines.push(
    `INSERT OR IGNORE INTO stock_movements (id,date,product_id,warehouse_id,qty_in_milli,qty_out_milli,unit_cost_paisa,` +
    `cost_total_paisa,ref_type,ref_id,book_code,note,created_at) VALUES (` +
    [q(`pseedmv-${slug}`), q(NOW.slice(0, 10)), q(p.key), q('wh-main'), qty, 0, 0, 0,
      q('OPENING'), q(p.key), q('OTHR'), q('STE staging opening — not a real purchase'), q(NOW)].join(',') + `);`,
  );
  lines.push(
    `INSERT OR IGNORE INTO stock_balance (product_id,warehouse_id,qty_milli,value_paisa,updated_at) VALUES (` +
    [q(p.key), q('wh-main'), qty, 0, q(NOW)].join(',') + `);`,
  );
}

mkdirSync(new URL('../seed', import.meta.url), { recursive: true });
writeFileSync(new URL('../seed/catalogue-staging.sql', import.meta.url), lines.join('\n') + '\n');
const priced = PRODUCTS.filter((p) => p.rate !== null).length;
console.log(`Generated seed/catalogue-staging.sql — ${PRODUCTS.length} products (${priced} with reference prices).`);
