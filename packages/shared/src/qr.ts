/** Dependency-free QR encoder (ISO/IEC 18004, 8-bit byte mode, versions 1–15).
 *  The printed invoice carries a scan URL, so the matrix has to exist at render time — no canvas,
 *  no network, no new dependency: it is pure synchronous code that also runs under
 *  renderToStaticMarkup in the print proof. Output is rendered as a 1-bit PNG data URL so the
 *  browser (and the printer) get crisp, pixel-exact modules.
 */
import { toBase64 } from './ids.js';

/** Error level → the 2-bit code used by the format information (ISO Table 15). */
const ECC_CODE: Record<Ecc, number> = { M: 0, L: 1 };

/** ISO/IEC 18004 Table 9 — per RS group: [blocks, codewords per block, data codewords per block]. */
const RS_BLOCKS: Record<string, readonly (readonly [number, number, number])[]> = {
  '1M': [[1, 26, 16]], '1L': [[1, 26, 19]],
  '2M': [[1, 44, 28]], '2L': [[1, 44, 34]],
  '3M': [[1, 70, 44]], '3L': [[1, 70, 55]],
  '4M': [[2, 50, 32]], '4L': [[1, 100, 80]],
  '5M': [[2, 67, 43]], '5L': [[1, 134, 108]],
  '6M': [[4, 43, 27]], '6L': [[2, 86, 68]],
  '7M': [[4, 49, 31]], '7L': [[2, 98, 78]],
  '8M': [[2, 60, 38], [2, 61, 39]], '8L': [[2, 121, 97]],
  '9M': [[3, 58, 36], [2, 59, 37]], '9L': [[2, 146, 116]],
  '10M': [[4, 69, 43], [1, 70, 44]], '10L': [[2, 86, 68], [2, 87, 69]],
  '11M': [[1, 80, 50], [4, 81, 51]], '11L': [[4, 101, 81]],
  '12M': [[6, 58, 36], [2, 59, 37]], '12L': [[2, 116, 92], [2, 117, 93]],
  '13M': [[8, 59, 37], [1, 60, 38]], '13L': [[4, 133, 107]],
  '14M': [[4, 64, 40], [5, 65, 41]], '14L': [[3, 145, 115], [1, 146, 116]],
  '15M': [[5, 65, 41], [5, 66, 42]], '15L': [[5, 109, 87], [1, 110, 88]],
};

/** ISO/IEC 18004 Table 1 / Annex E — alignment pattern centres. Version 1 has none. */
const ALIGN_POS: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
  9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
  14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
};

/** ISO/IEC 18004 Table 15 — 15-bit format info, indexed by (ecc code << 3) | mask. */
const FORMAT_INFO: readonly number[] = [
  21522, 20773, 24188, 23371, 17913, 16590, 20375, 19104,
  30660, 29427, 32170, 30877, 26159, 25368, 27713, 26998,
  5769, 5054, 7399, 6608, 1890, 597, 3340, 2107,
  13663, 12392, 16177, 14854, 9396, 8579, 11994, 11245,
];

/** ISO/IEC 18004 Table 17 — 18-bit version info, indexed by version - 7. */
const VERSION_INFO: readonly number[] = [31892, 34236, 39577, 42195, 48118, 51042, 55367, 58893, 63784];

export type Ecc = 'L' | 'M';
export interface QrMatrix { size: number; /** size * size, row-major, 1 = dark */ modules: Uint8Array }

/** GF(256) tables, primitive polynomial 0x11D. Built once at module load. */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/** Generator polynomial for `n` EC codewords: product of (x − α^i), coefficients descending,
 *  leading 1 dropped — so the result has exactly `n` entries. */
function genPoly(n: number): Uint8Array {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return Uint8Array.from(poly.slice(1));
}

/** Reversed RS remainder of `data` under `gen` — the EC codewords, most significant first. */
function rsRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array {
  const rem = new Uint8Array(gen.length);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[gen.length - 1] = 0;
    for (let i = 0; i < gen.length; i++) rem[i] ^= gfMul(gen[i], factor);
  }
  return rem;
}

const dataCodewords = (groups: readonly (readonly [number, number, number])[]): number =>
  groups.reduce((sum, [blocks, , data]) => sum + blocks * data, 0);

/** Longest byte-mode payload a version holds at this level (mode + count + terminator included). */
function capacityBytes(version: number, groups: readonly (readonly [number, number, number])[]): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewords(groups) * 8 - 4 - countBits) / 8);
}

/** Bit writer — MSB first into a Uint8Array, one bit per slot (simple beats compact here). */
class Bits {
  private readonly out: number[] = [];
  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.out.push((value >> i) & 1);
  }
  get length(): number { return this.out.length; }
  toArray(): Uint8Array { return Uint8Array.from(this.out); }
}

function encodePayload(text: string, ecc: Ecc): { bits: Uint8Array; version: number } {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  let groups: readonly (readonly [number, number, number])[] = [];
  for (let v = 1; v <= 15; v++) {
    const g = RS_BLOCKS[`${v}${ecc}`];
    if (g && capacityBytes(v, g) >= bytes.length) { version = v; groups = g; break; }
  }
  if (!version) throw new Error(`QR payload too long for versions 1–15 (${bytes.length} bytes)`);

  const capacity = dataCodewords(groups) * 8;
  const bits = new Bits();
  bits.push(4, 4);                                                  // 0100 = 8-bit byte mode
  bits.push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) bits.push(b, 8);
  bits.push(0, Math.min(4, capacity - bits.length));               // terminator
  while (bits.length % 8) bits.push(0, 1);                         // pad to a codeword
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) // 0xEC / 0x11 alternating
    bits.push(pad, 8);
  return { bits: bits.toArray(), version };
}

/** Split the data codewords into RS blocks, then interleave data and EC codewords (ISO 7.6). */
function interleave(bits: Uint8Array, groups: readonly (readonly [number, number, number])[]): Uint8Array {
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let cursor = 0;
  for (const [count, total, dataLength] of groups) {
    const gen = genPoly(total - dataLength);
    for (let i = 0; i < count; i++) {
      const data = bits.slice(cursor, cursor + dataLength * 8);
      cursor += dataLength * 8;
      const bytes = new Uint8Array(dataLength);
      for (let b = 0; b < dataLength; b++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | data[b * 8 + bit];
        bytes[b] = byte;
      }
      blocks.push({ data: bytes, ec: rsRemainder(bytes, gen) });
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  const maxEc = Math.max(...blocks.map((b) => b.ec.length));
  for (let i = 0; i < maxEc; i++) for (const b of blocks) if (i < b.ec.length) out.push(b.ec[i]);
  const bitsOut = new Uint8Array(out.length * 8);
  out.forEach((byte, i) => {
    for (let bit = 0; bit < 8; bit++) bitsOut[i * 8 + bit] = (byte >> (7 - bit)) & 1;
  });
  return bitsOut;
}

const MASKS: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** ISO 7.8.3 — the four penalty rules summed; the lowest score wins. */
function penalty(mod: Uint8Array, size: number): number {
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  // A 1:1:3:1:1 run counts only when it touches an edge or has four light modules on one side.
  const n3Runs = (seq: Uint8Array): number => {
    let count = 0;
    let idx = 0;
    while (idx <= seq.length - 7) {
      let hit = true;
      for (let k = 0; k < 7; k++) if (seq[idx + k] !== pattern[k]) { hit = false; break; }
      if (!hit) { idx++; continue; }
      const before = seq.subarray(Math.max(idx - 4, 0), idx);
      const after = seq.subarray(idx + 7, Math.min(idx + 11, seq.length));
      const qualified = idx === 0 || idx === seq.length - 7
        || !before.some((x) => x === 1) || !after.some((x) => x === 1);
      if (qualified) count += 40;
      idx += qualified ? 7 : 4;
    }
    return count;
  };
  let n1 = 0, n2 = 0, n3 = 0, dark = 0;
  const col = new Uint8Array(size);
  let prevRow: Uint8Array | null = null;
  for (let i = 0; i < size; i++) {
    const rowStart = i * size;
    const row = mod.subarray(rowStart, rowStart + size);
    let runRow = 0, runCol = 0, prevBit = -1, prevColBit = -1;
    for (let j = 0; j < size; j++) {
      const bit = row[j];
      const colBit = mod[j * size + i];
      col[j] = colBit;
      dark += bit;
      if (bit === prevBit) runRow++;
      else { if (runRow >= 5) n1 += runRow - 2; runRow = 1; }
      if (colBit === prevColBit) runCol++;
      else { if (runCol >= 5) n1 += runCol - 2; runCol = 1; }
      if (prevRow && j && bit === prevBit && prevRow[j] === prevRow[j - 1] && bit === prevRow[j]) n2 += 3;
      prevBit = bit;
      prevColBit = colBit;
    }
    if (runRow >= 5) n1 += runRow - 2;
    if (runCol >= 5) n1 += runCol - 2;
    prevRow = row;
    n3 += n3Runs(row) + n3Runs(col);
  }
  const percent = dark / (size * size);
  const n4 = 10 * Math.floor(Math.abs(percent * 100 - 50) / 5);
  return n1 + n2 + n3 + n4;
}

/** Draw finder + separator, timing, alignment and the reserved format/version zones.
 *  `reserved` marks every module the data walk must skip. */
function drawFunctionPatterns(version: number, mod: Uint8Array, reserved: Uint8Array): void {
  const size = 4 * version + 17;
  const at = (i: number, j: number) => i * size + j;
  const corners = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [r0, c0] of corners) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const i = r0 + dr, j = c0 + dc;
        if (i < 0 || j < 0 || i >= size || j >= size) continue;
        reserved[at(i, j)] = 1;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        mod[at(i, j)] = inside && (ring || core) ? 1 : 0;
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {          // timing patterns
    const dark = i % 2 === 0 ? 1 : 0;
    mod[at(6, i)] = dark; reserved[at(6, i)] = 1;
    mod[at(i, 6)] = dark; reserved[at(i, 6)] = 1;
  }
  const positions = ALIGN_POS[version];
  const min = positions[0];
  const max = positions[positions.length - 1];
  for (const r of positions) {
    for (const c of positions) {
      // The three corners that would sit on a finder are omitted; the ones crossing the timing
      // pattern are intentional and overwrite it, exactly as the standard draws them.
      if ((r === min && c === min) || (r === min && c === max) || (r === max && c === min)) continue;
      if (r > size - 6 || c > size - 6) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          mod[at(r + dr, c + dc)] = edge === 2 || (dr === 0 && dc === 0) ? 1 : 0;
          reserved[at(r + dr, c + dc)] = 1;
        }
      }
    }
  }
  // Format info: row 8 / col 8 in both the top-left and the split top-right + bottom-left copy.
  for (let i = 0; i <= 8; i++) { reserved[at(8, i)] = 1; reserved[at(i, 8)] = 1; }
  for (let i = 0; i < 8; i++) { reserved[at(8, size - 1 - i)] = 1; reserved[at(size - 1 - i, 8)] = 1; }
  // The always-dark module: reserved (never masked, never data), but drawn only with the format
  // information. Leaving it light during mask evaluation matches ISO 7.8.3 — the reference
  // implementation scores masks before any format/version modules are drawn.
  reserved[at(size - 8, 8)] = 1;
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 3; k++) {
        reserved[at(size - 11 + k, i)] = 1;
        reserved[at(i, size - 11 + k)] = 1;
      }
    }
  }
}

/** ISO 7.7.3 — two-module-wide columns, right to left, alternating up and down, skipping col 6. */
function placeCodewords(version: number, codewordBits: Uint8Array, mod: Uint8Array, reserved: Uint8Array): void {
  const size = 4 * version + 17;
  // Column pairs are [size-1, size-3, …]; below col 8 the pair shifts one left so col 6 (timing)
  // is never a data column. The shift must not feed back into the stride, hence this pre-computed
  // walk: mutating a loop counter would drop the last pairs.
  const starts: number[] = [];
  for (let right = size - 1; right > 0; right -= 2) starts.push(right <= 6 ? right - 1 : right);
  let idx = 0;
  for (const right of starts) {
    for (let vertical = 0; vertical < size; vertical++) {
      for (let z = 0; z < 2; z++) {
        const j = right - z;
        let upwards = (right & 2) === 0;
        if (j < 6) upwards = !upwards;
        const i = upwards ? size - 1 - vertical : vertical;
        if (reserved[i * size + j] === 0 && idx < codewordBits.length) {
          mod[i * size + j] = codewordBits[idx];
          idx++;
        }
      }
    }
  }
  if (idx !== codewordBits.length) {
    throw new Error(`QR placement wrote ${idx} of ${codewordBits.length} bits (version ${version})`);
  }
}

function writeFormatInfo(ecc: Ecc, mask: number, mod: Uint8Array, version: number): void {
  const size = 4 * version + 17;
  const at = (i: number, j: number) => i * size + j;
  const info = FORMAT_INFO[(ECC_CODE[ecc] << 3) | mask];
  let vOffset = 0, hOffset = 0;
  for (let i = 0; i < 8; i++) {
    const vBit = (info >> i) & 1;
    const hBit = (info >> (14 - i)) & 1;
    if (i === 6) { vOffset = 1; hOffset = 1; }        // the timing pattern sits in the run
    mod[at(i + vOffset, 8)] = vBit;
    mod[at(8, i + hOffset)] = hBit;
    mod[at(8, size - 1 - i)] = vBit;
    mod[at(size - 1 - i, 8)] = hBit;
  }
  mod[at(size - 8, 8)] = 1;                              // the always-dark module wins that slot
  if (version < 7) return;
  const vInfo = VERSION_INFO[version - 7];
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 3; k++) {
      const bit = (vInfo >> (i * 3 + k)) & 1;
      mod[at(size - 11 + k, i)] = bit;
      mod[at(i, size - 11 + k)] = bit;
    }
  }
}

/** Encode `text` into a QR module matrix. Throws only if the payload exceeds version 15.
 *  `forceMask` pins the data mask (0–7); production omits it and takes the lowest-penalty mask,
 *  which is what the standard tells an encoder to do. It exists so tests can compare every mask
 *  against a reference implementation instead of only the one a penalty tie-break happens to pick.
 */
export function qrEncode(text: string, ecc: Ecc = 'M', forceMask?: number): QrMatrix {
  const { bits, version } = encodePayload(text, ecc);
  const groups = RS_BLOCKS[`${version}${ecc}`];
  const codewordBits = interleave(bits, groups);
  const size = 4 * version + 17;

  const base = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);
  drawFunctionPatterns(version, base, reserved);
  placeCodewords(version, codewordBits, base, reserved);

  let best: Uint8Array | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  for (const m of forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask]) {
    const candidate = Uint8Array.from(base);
    const fn = MASKS[m];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (reserved[i * size + j] === 0 && fn(i, j)) candidate[i * size + j] ^= 1;
      }
    }
    const score = penalty(candidate, size);
    if (score < bestScore) { bestScore = score; bestMask = m; best = candidate; }
  }
  const modules = best!;
  writeFormatInfo(ecc, bestMask, modules, version);
  return { size, modules };
}

/** PNG chunk CRC (ISO 3309) and zlib adler-32 — both needed for a hand-built raster. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): number[] {
  const out: number[] = [];
  const len = data.length;
  out.push(len >>> 24 & 0xff, len >>> 16 & 0xff, len >>> 8 & 0xff, len & 0xff);
  const body = new Uint8Array(type.length + len);
  for (let i = 0; i < type.length; i++) body[i] = type.charCodeAt(i);
  body.set(data, type.length);
  const crcInput = new Uint8Array(body.length);
  crcInput.set(body);
  for (let i = 0; i < body.length; i++) out.push(body[i]);
  const crc = crc32(crcInput);
  out.push(crc >>> 24 & 0xff, crc >>> 16 & 0xff, crc >>> 8 & 0xff, crc & 0xff);
  return out;
}

/** zlib stream of stored (uncompressed) deflate blocks — the modules must stay pixel-exact. */
function storedDeflate(raw: Uint8Array): Uint8Array {
  const max = 0xffff;
  const out = new Uint8Array(2 + raw.length + Math.ceil(raw.length / max) * 5 + 4);
  let p = 0;
  out[p++] = 0x78; out[p++] = 0x01;                     // CMF / FLG, no preset dictionary
  let offset = 0;
  let adler = 1;
  let a = 1, b = 0;
  do {
    const block = raw.subarray(offset, offset + Math.min(max, raw.length - offset));
    const final = offset + block.length >= raw.length ? 1 : 0;
    out[p++] = final;
    const len = block.length;
    out[p++] = len & 0xff; out[p++] = len >>> 8 & 0xff;
    out[p++] = ~len & 0xff; out[p++] = (~len >>> 8) & 0xff;
    out.set(block, p); p += len;
    offset += len;
    for (const byte of block) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  } while (offset < raw.length);
  adler = ((b << 16) | a) >>> 0;
  out[p++] = adler >>> 24 & 0xff; out[p++] = adler >>> 16 & 0xff;
  out[p++] = adler >>> 8 & 0xff; out[p++] = adler & 0xff;
  return out.subarray(0, p);
}

function be32(n: number): number[] { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; }

/** 1-bit grayscale PNG of the matrix, dark = module, light = paper, `quiet` modules of white border. */
export function qrPngBytes(matrix: QrMatrix, options: { scale?: number; quiet?: number } = {}): Uint8Array {
  const scale = Math.max(1, Math.floor(options.scale ?? 4));
  const quiet = Math.max(0, Math.floor(options.quiet ?? 4));   // ISO minimum margin is 4 modules
  const cells = matrix.size + quiet * 2;
  const width = cells * scale;
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array(width * (rowBytes + 1));
  const isDark = (i: number, j: number): boolean => {
    if (i < quiet || j < quiet || i >= quiet + matrix.size || j >= quiet + matrix.size) return false;
    return matrix.modules[(i - quiet) * matrix.size + (j - quiet)] === 1;
  };
  for (let y = 0; y < width; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;                                   // filter: None
    const i = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      // 1-bit PNG greyscale is inverted relative to ink: sample 0 is black, 1 is white paper.
      if (isDark(i, Math.floor(x / scale))) continue;
      raw[rowStart + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = new Uint8Array([...be32(width), ...be32(width), 1, 0, 0, 0, 0]);
  const png: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  png.push(...chunk('IHDR', ihdr), ...chunk('IDAT', storedDeflate(raw)), ...chunk('IEND', new Uint8Array(0)));
  return Uint8Array.from(png);
}

/** data: URL for an `<img>` src — synchronous, so it survives renderToStaticMarkup. */
export function qrDataUrl(text: string, options: { scale?: number; quiet?: number; ecc?: Ecc } = {}): string {
  return `data:image/png;base64,${toBase64(qrPngBytes(qrEncode(text, options.ecc ?? 'M'), options))}`;
}
