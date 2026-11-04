/**
 * Derive the shipped brand assets from the masters in images/brand/ (app icons, maskable icon,
 * Apple touch icon and the social-share card). Raster only — the site forbids SVG and emoji marks.
 * Run after replacing a master: node scripts/brand-assets.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = `${ROOT}images/brand`;
const OUT = `${ROOT}apps/web/public`;
mkdirSync(`${OUT}/icons`, { recursive: true });
mkdirSync(`${OUT}/og`, { recursive: true });

// Indexed PNG keeps the flat emblem crisp at a fraction of the bytes of a 24-bit encode.
const icon = (buf, size, rel) => sharp(buf).resize(size, size).png({ palette: true, quality: 82 }).toFile(`${OUT}${rel}`);

// ---------------------------------- icons ------------------------------------
const logoPng = await sharp(`${SRC}/logo-mark.png`).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
await icon(logoPng, 512, '/icons/icon-512.png');
await icon(logoPng, 192, '/icons/icon-192.png');
await icon(logoPng, 32, '/icons/icon-32.png');
await icon(logoPng, 180, '/icons/apple-touch-icon.png');

// In-page brand mark (header, footer, login, invoice header) — small enough to ship inline.
mkdirSync(`${OUT}/brand`, { recursive: true });
await icon(logoPng, 256, '/brand/logo-256.png');
await icon(logoPng, 96, '/brand/logo-96.png');

// Maskable: the mark must sit inside the safe zone. The field is sampled from the master's own
// corner so the shrunk mark cannot leave a visible seam against a hand-picked colour.
const field = await sharp(logoPng).extract({ left: 0, top: 0, width: 1, height: 1 }).resize(512, 512).png().toBuffer();
const safe = await sharp(logoPng).resize(340, 340).png().toBuffer();
await sharp(field).composite([{ input: safe, gravity: 'centre' }])
  .png({ palette: true, quality: 82 }).toFile(`${OUT}/icons/icon-maskable-512.png`);

// ------------------------------ social share ---------------------------------
const share = sharp(`${SRC}/social-share.png`);
for (const [w, h, name] of [[1200, 630, 'og-1200x630.jpg'], [2400, 1260, 'og-2400x1260.webp'], [3840, 2016, 'og-4k.webp']]) {
  const sized = await share.clone().resize(w, h, { fit: 'cover', position: 'centre' });
  await (name.endsWith('.jpg') ? sized.jpeg({ quality: 82, progressive: true }) : sized.webp({ quality: 80 }))
    .toFile(`${OUT}/og/${name}`);
}

console.log('brand assets written to apps/web/public/{icons,brand,og}');
