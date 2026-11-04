/**
 * Media store with three backends, tried in order:
 *   1. R2 (`FILES` binding)                      — production once the owner enables R2.
 *   2. D1 `media_blobs`                          — works on accounts without R2; size-capped.
 *   3. local preview directory                   — dev only.
 * Callers get the same key back either way, so `/media/<key>` URLs never change.
 */
import type { AppContext } from '../context.js';
import { BizError, nowIso } from '../context.js';

/** D1 rows stay well under the per-statement limit; QR codes and payment screenshots fit easily. */
export const MAX_BLOB_BYTES = 512 * 1024;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function mimeFor(key: string): string {
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.avif')) return 'image/avif';
  return 'image/jpeg';
}

export async function putMedia(c: AppContext, key: string, bytes: Uint8Array): Promise<void> {
  if (c.env.FILES) {
    await c.env.FILES.put(key, bytes, { customMetadata: { stored: 'r2' } });
    return;
  }
  if (c.env.__ZT_LOCAL_BACKUP_DIR__) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(c.env.__ZT_LOCAL_BACKUP_DIR__, 'uploads', key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    return;
  }
  if (bytes.length > MAX_BLOB_BYTES) {
    throw new BizError(413, 'MEDIA_TOO_LARGE', 'تصویر بہت بڑی ہے، اسے چھوٹا کر کے بھیجیں',
      `Image must be under ${Math.floor(MAX_BLOB_BYTES / 1024)} KB without R2`);
  }
  const db = c.get('db')!;
  await db.prepare(`INSERT INTO media_blobs (key,mime,size_bytes,data_b64,created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET mime=excluded.mime,size_bytes=excluded.size_bytes,
      data_b64=excluded.data_b64,created_at=excluded.created_at`)
    .bind(key, mimeFor(key), bytes.length, b64(bytes), nowIso()).run();
}

export async function getMedia(c: AppContext, key: string): Promise<{ body: ArrayBuffer; mime: string } | null> {
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(key);
    if (!obj) return null;
    return { body: await obj.arrayBuffer(), mime: mimeFor(key) };
  }
  // Local preview writes product images to disk; checkout proofs and QR codes land in D1.
  if (c.env.__ZT_LOCAL_BACKUP_DIR__) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    try {
      const buf = await fs.readFile(path.join(c.env.__ZT_LOCAL_BACKUP_DIR__, 'uploads', key));
      return { body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, mime: mimeFor(key) };
    } catch { /* fall through to D1 */ }
  }
  const db = c.get('db')!;
  const row = await db.prepare('SELECT mime,data_b64 FROM media_blobs WHERE key=?').bind(key).first<{ mime: string; data_b64: string }>();
  if (!row) return null;
  return { body: unb64(row.data_b64).buffer as ArrayBuffer, mime: row.mime };
}

/** Accepts a base64 data URL, validates the format, and returns raw bytes. */
export function decodeDataUrl(dataUrl: string, allowed: string[]): { bytes: Uint8Array; mime: string; ext: string } {
  const m = /^data:image\/(webp|jpeg|jpg|png|avif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) throw new BizError(400, 'INVALID_IMAGE', 'تصویر کا فارمیٹ درست نہیں', 'Only WebP/JPEG/PNG/AVIF data URLs');
  if (!allowed.includes(m[1])) {
    throw new BizError(400, 'UNSUPPORTED_IMAGE', `یہ قسم کی تصویر ممنوع ہے: ${m[1]}`, `Image type not accepted: ${m[1]}`);
  }
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  return { bytes, mime: `image/${ext}`, ext };
}
