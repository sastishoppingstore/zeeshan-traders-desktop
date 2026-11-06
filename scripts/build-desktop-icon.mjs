/**
 * Builds build/icon.ico (Windows) from the web app's 512px brand mark.
 *
 * electron-builder normally converts a PNG itself, but its bundled `icon-tool.js` is CommonJS and
 * the repo's package.json is `"type": "module"`, so the converter crashes on Node 22 with
 * "require is not defined in ES module scope". Shipping a real multi-size .ico means electron-builder
 * never has to run that tool.
 *
 * Regenerate after changing apps/web/public/icons/icon-512.png:
 *   npm run icon:desktop
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'apps/web/public/icons/icon-512.png';
const OUT = path.join('build', 'icon.ico');
// Windows picks the closest size; PNG-compressed entries keep the file small.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const images = [];
for (const size of SIZES) {
  const png = await sharp(SRC)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  images.push({ size, png });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(images.length, 4);

const directory = Buffer.alloc(16 * images.length);
let offset = 6 + directory.length;
images.forEach((img, i) => {
  const entry = directory.subarray(i * 16, (i + 1) * 16);
  // 0 means 256 in the ICO directory.
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width
  entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
  entry.writeUInt8(0, 2); // palette colours
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(img.png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += img.png.length;
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, directory, ...images.map((i) => i.png)]));
console.log(`wrote ${OUT} (${SIZES.join('/')} px, ${fs.statSync(OUT).size} bytes)`);