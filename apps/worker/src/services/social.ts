/**
 * Server-side social card for the SPA shell. Crawlers (Facebook, WhatsApp, X) do not run the
 * React app, so the og:* tags shipped in index.html are rewritten here with absolute URLs and,
 * for a product page, that product's own name, price and photo.
 * Only the HTML shell is touched — API and media responses are untouched.
 */
import { formatPKR } from '@zt/shared';
import type { DB } from '../db.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setMeta(html: string, key: string, value: string): string {
  const re = new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`);
  return re.test(html) ? html.replace(re, `$1${esc(value)}$2`) : html;
}

export async function socialHtml(db: DB, origin: string, path: string, html: string): Promise<string> {
  let out = setMeta(html, 'og:url', `${origin}${path}`);
  out = out.replace(/content="\/og\//g, `content="${origin}/og/`);

  // Slugs carry Urdu letters, so match any single path segment rather than an ASCII class.
  const seg = /^\/product\/([^/]{1,140})\/?$/i.exec(path)?.[1];
  if (!seg) return out;
  const slug = decodeURIComponent(seg).slice(0, 120);
  const p = await db.prepare(
    `SELECT p.name_ur,p.name_en,p.show_public_price,p.public_price_paisa,c.name_ur AS category_ur,
      (SELECT i.r2_key FROM product_images i WHERE i.product_id=p.id ORDER BY i.is_primary DESC,i.sort LIMIT 1) AS image_key
     FROM products p JOIN product_categories c ON c.id=p.category_id
     WHERE p.slug=? AND p.is_published=1 AND p.is_active=1`).bind(slug).first<any>();
  if (!p) return out;

  const name = p.name_ur || p.name_en;
  const price = p.show_public_price && p.public_price_paisa > 0
    ? `قیمت ${formatPKR(p.public_price_paisa)}` : 'قیمت کے لیے رابطہ کریں';
  out = setMeta(out, 'og:title', `${name} — ${p.category_ur ?? 'ذیشان ٹریڈرز'}`);
  out = setMeta(out, 'og:description', `${name}۔ ${price}۔ مقصود چوک، ضلع لیہ — آج کا ریٹ، واٹس ایپ پر آرڈر۔`);
  out = setMeta(out, 'twitter:title', `${name} — ${p.category_ur ?? 'ذیشان ٹریڈرز'}`);
  out = setMeta(out, 'twitter:description', `${name}۔ ${price}۔`);
  if (p.image_key) {
    out = setMeta(out, 'og:image', `${origin}/media/${String(p.image_key).replace(/[^\w./-]/g, '')}`);
    out = setMeta(out, 'twitter:image', `${origin}/media/${String(p.image_key).replace(/[^\w./-]/g, '')}`);
    out = setMeta(out, 'og:image:alt', name);
  }
  return out;
}
