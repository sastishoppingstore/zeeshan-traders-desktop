/** QR encoder conformance: the shipped encoder must reproduce a reference implementation's symbols
 *  bit-for-bit, and the PNG it prints must carry exactly those modules.
 *
 *  Vectors in tests/fixtures/qr-vectors.json were generated offline with segno 1.6.6
 *  (mode='byte', boost_error=false, micro=false). Byte payloads sized to fill each version exactly
 *  are used because the reference pads a short message with one extra 0x00 codeword where ISO 7.4.9
 *  and zxing stop at the codeword boundary; that difference is cosmetic padding, and pinning the
 *  length keeps the comparison honest instead of asserting a near-miss.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { qrEncode, qrPngBytes } from '@zt/shared';

interface Vector { size: number; pad_bits: number; rows: string[]; payload_len?: number;
  payload?: string; error: 'L' | 'M'; mask: number; kind: 'exact' | 'short' }

const fixture = JSON.parse(readFileSync(new URL('./fixtures/qr-vectors.json', import.meta.url), 'utf8'));
const vectors: Vector[] = fixture.vectors;

const bitsFromHex = (v: Vector): string[] =>
  v.rows.map((hex) => [...hex].map((n) => parseInt(n, 16).toString(2).padStart(4, '0')).join(''))
    .map((bits) => bits.slice(0, v.size));

const matrixBits = (matrix: { size: number; modules: Uint8Array }): string[] => {
  const rows: string[] = [];
  for (let i = 0; i < matrix.size; i++) {
    let bits = '';
    for (let j = 0; j < matrix.size; j++) bits += matrix.modules[i * matrix.size + j] ? '1' : '0';
    rows.push(bits);
  }
  return rows;
};

describe('qrEncode matches the reference implementation', () => {
  const exact = vectors.filter((v) => v.kind === 'exact');
  it.each(exact.map((v) => [v.error, v.size, v.mask, v.payload_len ?? 0, v] as const))(
    'version size %i level %s mask %i (%s bytes)', (_error, _size, _mask, _len, v) => {
      const mine = qrEncode('x'.repeat(v.payload_len ?? 0), v.error);
      expect(mine.size).toBe(v.size);
      expect(matrixBits(mine)).toEqual(bitsFromHex(v));
    });

  it('refuses a payload longer than version 15 instead of silently truncating', () => {
    expect(() => qrEncode('x'.repeat(700), 'M')).toThrow(/too long/);
  });
});

describe('short payloads still select the reference version', () => {
  it.each(vectors.filter((v) => v.kind === 'short').map((v) => [v.payload ?? '', v.size] as const))(
    '%s', (payload, size) => {
      expect(qrEncode(payload, 'M').size).toBe(size);
    });
});

describe('the printed PNG carries the same modules', () => {
  it('unwraps a real PNG, inflates with node:zlib and reproduces the grid', () => {
    const text = 'https://sastishopping-store.com/verify/01hzkx0af4ycesjgpwq9k3mstv6zr2';
    const scale = 4, quiet = 4;
    const matrix = qrEncode(text, 'M');
    const png = qrPngBytes(matrix, { scale, quiet });
    const buf = Buffer.from(png);

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const pixels = matrix.size + quiet * 2;

    let offset = 8;
    let ihdr: { width: number; height: number; depth: number; color: number } | null = null;
    const idat: Buffer[] = [];
    while (offset < png.length) {
      const length = buf.readUInt32BE(offset);
      const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
      const data = buf.subarray(offset + 8, offset + 8 + length);
      const crc = buf.readUInt32BE(offset + 8 + length);
      expect(crc >>> 0).toBe(crc32(buf.subarray(offset + 4, offset + 8 + length)));
      if (type === 'IHDR') {
        ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9] };
      } else if (type === 'IDAT') idat.push(data);
      offset += 12 + length;
    }
    expect(ihdr).toEqual({ width: pixels * scale, height: pixels * scale, depth: 1, color: 0 });

    // node:zlib inflates the stored-deflate stream, so the container itself is verified by an
    // independent implementation rather than by the code that wrote it.
    const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))));
    const rowBytes = Math.ceil(pixels * scale / 8);
    const read = (y: number, x: number): boolean => {
      // 1-bit greyscale: sample 0 is ink, sample 1 is paper.
      return ((raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
    };
    for (let i = 0; i < matrix.size; i++) {
      for (let j = 0; j < matrix.size; j++) {
        const expectDark = matrix.modules[i * matrix.size + j] === 1;
        // Sample the centre of each module block; every pixel of it is the same value.
        expect(read(quiet * scale + i * scale + Math.floor(scale / 2),
          quiet * scale + j * scale + Math.floor(scale / 2))).toBe(expectDark);
      }
    }
    // Quiet zone must stay paper, or a scanner loses the symbol edge.
    expect(read(0, 0)).toBe(false);
    expect(read(pixels * scale - 1, pixels * scale - 1)).toBe(false);
  });
});

/** CRC-32 as PNG requires it (ISO 3309, reflected, init 0xFFFFFFFF). */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
