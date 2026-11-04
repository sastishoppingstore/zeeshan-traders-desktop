// Central asset map: which bundled photo represents which category / product / hero surface.
// Real uploads (product.images[] from the API, stored in R2) always win; this map is the
// brand-quality fallback so the site never shows an empty box or an invented placeholder.
import { IMAGES, type ImageKey } from './images.js';

export type PhotoRef = { key: ImageKey; alt_ur: string; alt_en: string };

const photo = (key: ImageKey, alt_ur: string, alt_en: string): PhotoRef => ({ key, alt_ur, alt_en });

/** The four faces of the signature hero cube: fertilizer, pesticide, wheat, wanda. */
export const HERO_CUBE: PhotoRef[] = [
  photo('categories/cat-fertilizer', 'کھاد کی تھیلی', 'Fertilizer bag'),
  photo('categories/cat-pesticide', 'پیسٹی سائیڈ بوتل', 'Pesticide container'),
  photo('categories/cat-wheat', 'گندم کے دانے', 'Wheat grains'),
  photo('products/product-wanda-1', 'ونڈا کی تھیلی', 'Cotton seed (wanda) bag'),
];

export const HERO_BG = photo('hero/hero-bg', 'خریفی میدان', 'Agricultural fields');
export const HERO_WHEAT = photo('hero/hero-wheat', 'سنتے ہوئے گندم کے کھیت', 'Ripening wheat field');

/** Keyed by the seeded `product_categories.code`, with `slug` accepted as an alias. */
export const CATEGORY_MEDIA: Record<string, PhotoRef> = {
  FERT: photo('categories/cat-fertilizer', 'کھاد', 'Fertilizer'),
  PEST: photo('categories/cat-pesticide', 'پیسٹی سائیڈ', 'Pesticide'),
  CHOK: photo('products/product-wheat-bran-1', 'چوکر', 'Wheat bran (choker)'),
  WAND: photo('products/product-wanda-1', 'ونڈا', 'Cotton seed (wanda)'),
  CEM: photo('categories/cat-cement', 'سیمنٹ', 'Cement bags'),
  SEED: photo('categories/cat-seeds', 'بیج', 'Certified seeds'),
  OTHR: photo('categories/cat-tools', 'دیگر زرعی سامان', 'Other agricultural goods'),
  GRAINS: photo('categories/cat-wheat', 'اجناس', 'Grains'),
  WHEAT: photo('categories/cat-wheat', 'گندم', 'Wheat'),
  RICE: photo('categories/cat-rice', 'چاول', 'Rice'),
  SESAME: photo('categories/cat-sesame', 'تل', 'Sesame'),
  MILLET: photo('categories/cat-millet', 'باجرہ', 'Millet'),
  MAIZE: photo('categories/cat-maize', 'مکئی', 'Maize'),
  MOONG: photo('categories/cat-moong', 'مونگی', 'Moong beans'),
  MUSTARD: photo('categories/cat-mustard', 'سرسوں', 'Mustard'),
};

/** Ordered grain rail used by the home showcase and the ERP grains hub (ERP-14/15). */
export const GRAIN_ORDER = ['WHEAT', 'RICE', 'SESAME', 'MILLET', 'MAIZE', 'MOONG', 'MUSTARD'] as const;

export const ABOUT_MEDIA: PhotoRef[] = [
  photo('about/about-shop', 'دکان کا اندر منظر', 'Inside the shop'),
  photo('about/about-weighing', 'ترّاوی کا منظر', 'Weighing grain'),
  photo('about/about-warehouse', 'گودام', 'Grain storage'),
  photo('about/about-farmers', 'کسان', 'Farmers in the field'),
];

export const SHOWCASE_MEDIA: PhotoRef[] = [
  photo('about/about-farmer', 'کسان کھیت میں', 'Farmer in the field'),
  photo('hero/hero-wheat', 'گندم کا کھیت', 'Wheat field'),
  photo('about/about-grain-bowls', 'اجناس کے پیالے', 'Bowls of grain'),
  photo('about/about-goods', 'زرعی سامان', 'Agricultural goods'),
  photo('about/about-delivery', 'ترسیل', 'Delivery'),
  photo('about/about-showroom', 'نمائش گاہ', 'Showroom'),
];

/**
 * Token map for products that exist but have no uploaded photo yet.
 * Matched against word tokens of `name_en`, `name_ur`, `sku`, `brand_en` — never substrings,
 * so `tel` (oil) cannot accidentally claim the sesame photo through an unrelated name.
 */
const PRODUCT_TOKEN_MEDIA: Record<string, string> = {
  urea: 'products/product-urea',
  khad: 'categories/cat-fertilizer',
  کھاد: 'categories/cat-fertilizer',
  fertilizer: 'categories/cat-fertilizer',
  dap: 'products/product-dap',
  npk: 'products/product-npk',
  zink: 'products/product-npk',
  insecticide: 'products/product-insecticide',
  fungicide: 'products/product-fungicide',
  herbicide: 'products/product-herbicide',
  pesticide: 'products/product-pesticide',
  pest: 'products/product-pesticide',
  sprayer: 'products/product-sprayer',
  sprinkler: 'products/product-sprayer',
  irrigation: 'products/product-irrigation',
  pipe: 'products/product-irrigation',
  cement: 'products/product-cement',
  سیمنٹ: 'products/product-cement',
  wanda: 'products/product-wanda-1',
  ونڈا: 'products/product-wanda-1',
  cotton: 'products/product-cotton-seeds',
  کپاس: 'products/product-cotton-seeds',
  chokar: 'products/product-wheat-bran-1',
  choker: 'products/product-wheat-bran-1',
  bran: 'products/product-wheat-bran-1',
  چوکر: 'products/product-wheat-bran-1',
  cattle: 'products/product-cattle-feed-1',
  livestock: 'products/product-cattle-feed-1',
  feed: 'products/product-cattle-feed-1',
  wheat: 'products/product-wheat-1',
  گندم: 'products/product-wheat-1',
  rice: 'products/product-rice-1',
  چاول: 'products/product-rice-1',
  paddy: 'products/product-rice-1',
  sesame: 'products/product-sesame-1',
  تل: 'products/product-sesame-1',
  'bajra': 'products/product-millet',
  باجرہ: 'products/product-millet',
  millet: 'products/product-millet',
  maize: 'products/product-maize',
  corn: 'products/product-maize',
  مکئی: 'products/product-maize',
  moong: 'products/product-moong',
  مونگی: 'products/product-moong',
  mustard: 'products/product-mustard',
  سرسوں: 'products/product-mustard',
  // Variants: the specific token is always the first word of `name_en`, so it wins over the
  // generic one above (productMedia takes the first token hit).
  durum: 'products/product-wheat-5',
  درم: 'products/product-wheat-5',
  sill: 'products/product-wheat-4',
  سِل: 'products/product-wheat-4',
  super: 'products/product-wheat-3',
  local: 'products/product-wheat-2',
  basmati: 'products/product-rice-2',
  بسمتی: 'products/product-rice-2',
  sella: 'products/product-rice-3',
  سیلا: 'products/product-rice-3',
  tolai: 'products/product-sesame-2',
  تولی: 'products/product-sesame-2',
  black: 'products/product-sesame-black',
  کالی: 'products/product-sesame-black',
  chuni: 'products/product-wanda-2',
  چھنی: 'products/product-wanda-2',
  khal: 'products/product-cattle-feed-2',
  کھلی: 'products/product-cattle-feed-2',
  fine: 'products/product-wheat-bran-2',
  باریک: 'products/product-wheat-bran-2',
  coarse: 'products/product-wheat-bran-3',
  موٹا: 'products/product-wheat-bran-3',
  seed: 'products/product-cotton-seeds',
  seeds: 'products/product-cotton-seeds',
  بیج: 'products/product-cotton-seeds',
  tool: 'categories/cat-tools',
  tools: 'categories/cat-tools',
};

const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

function tokens(...values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    for (const raw of v.toLowerCase().split(TOKEN_SPLIT)) {
      const t = raw.trim();
      if (t.length > 1) out.push(t);
    }
  }
  return out;
}

/** Category photo by `code` (preferred) or `slug`; undefined for unknown categories. */
export function categoryMedia(cat: { code?: string | null; slug?: string | null } | null | undefined): PhotoRef | undefined {
  if (!cat) return undefined;
  const byCode = cat.code ? CATEGORY_MEDIA[cat.code.toUpperCase()] : undefined;
  if (byCode) return byCode;
  const slug = cat.slug?.toUpperCase();
  return slug ? CATEGORY_MEDIA[slug] : undefined;
}

/** Photo for a catalogue row: the real upload first, then the token map, then nothing. */
export function productMedia(p: {
  images?: { url: string; alt_ur?: string }[];
  name_ur?: string | null;
  name_en?: string | null;
  sku?: string | null;
  brand_en?: string | null;
  brand_ur?: string | null;
  category_code?: string | null;
  category_slug?: string | null;
  category_ur?: string | null;
  category_en?: string | null;
}): { src: string; alt: string; source: 'upload' | 'asset' } | undefined {
  const upload = p.images?.[0]?.url;
  if (upload) return { src: upload, alt: p.name_ur || p.name_en || '', source: 'upload' };

  for (const t of tokens(p.name_en, p.name_ur, p.sku, p.brand_en, p.brand_ur)) {
    const hit = PRODUCT_TOKEN_MEDIA[t] ?? PRODUCT_TOKEN_MEDIA[t.replace(/s$/, '')];
    if (hit) {
      return { src: IMAGES[hit as ImageKey].lg, alt: `${p.name_ur || ''} ${p.name_en || ''}`.trim(), source: 'asset' };
    }
  }
  const cat = categoryMedia({ code: p.category_code, slug: p.category_slug }) ?? categoryByName(p.category_ur, p.category_en);
  if (cat) return { src: IMAGES[cat.key].lg, alt: cat.alt_ur, source: 'asset' };
  return undefined;
}

/** Public API rows carry `category_ur`/`category_en`, not the code — resolve the photo by name. */
const CATEGORY_NAME_CODES: Record<string, string> = {
  'کھاد': 'FERT',
  'پیسٹی سائیڈ': 'PEST',
  'چوکر': 'CHOK',
  'ونڈا': 'WAND',
  'سیمنٹ': 'CEM',
  'بیج': 'SEED',
  'دیگر زرعی سامان': 'OTHR',
  'اجناس': 'GRAINS',
  'گندم': 'WHEAT',
  'چاول': 'RICE',
  'تل': 'SESAME',
  'باجرہ': 'MILLET',
  'مکئی': 'MAIZE',
  'مونگی': 'MOONG',
  'سرسوں': 'MUSTARD',
  'fertilizer': 'FERT', 'pesticide': 'PEST', 'choker': 'CHOK', 'wanda': 'WAND',
  'cement': 'CEM', 'seeds': 'SEED', 'grains': 'GRAINS', 'wheat': 'WHEAT', 'rice': 'RICE',
  'sesame': 'SESAME', 'millet': 'MILLET', 'maize': 'MAIZE', 'moong': 'MOONG', 'mustard': 'MUSTARD',
};

export function categoryByName(...names: (string | null | undefined)[]): PhotoRef | undefined {
  for (const n of names) {
    const key = n?.trim().toLowerCase();
    if (!key) continue;
    const code = CATEGORY_NAME_CODES[key] ?? CATEGORY_NAME_CODES[n!.trim()];
    if (code) return CATEGORY_MEDIA[code];
  }
  return undefined;
}

/** The ERP stores only a key string; `/images/...` and absolute URLs are already usable paths. */
export function mediaUrl(ref: string | null | undefined): string | undefined {
  if (!ref) return undefined;
  if (ref.startsWith('/') || ref.startsWith('http')) return ref;
  return `/media/${ref}`;
}

export function cubePhoto(i: number): string {
  return IMAGES[HERO_CUBE[i % HERO_CUBE.length].key].lg;
}
