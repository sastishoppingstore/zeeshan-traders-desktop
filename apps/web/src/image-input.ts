/**
 * Client-side image intake for uploads (payment proofs, QR codes, product photos).
 * The D1 media fallback stores blobs up to 512 KB, so every upload is downscaled and
 * re-encoded to WebP (JPEG when the browser cannot encode WebP) before it leaves the device.
 */

export const UPLOAD_MAX_BYTES = 480 * 1024;

export interface ImageInput {
  data_url: string;
  bytes: number;
  mime: string;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('فائل پڑھی نہیں جا سکی'));
    r.readAsDataURL(file);
  });
}

function pickMime(canvas: HTMLCanvasElement): { mime: string; ext: string } {
  const test = canvas.toDataURL('image/webp');
  return test.startsWith('data:image/webp') ? { mime: 'image/webp', ext: 'webp' } : { mime: 'image/jpeg', ext: 'jpg' };
}

/** Downscale to `maxEdge` then walk the quality ladder down until the payload fits maxBytes. */
export async function shrinkImage(file: File, maxEdge = 1200, maxBytes = UPLOAD_MAX_BYTES): Promise<ImageInput> {
  const dataUrl = await readFile(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('تصویر کھلی نہیں'));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('کنوس نہیں ملا');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { mime } = pickMime(canvas);
  let out = '';
  for (const q of [0.82, 0.72, 0.6, 0.5, 0.4]) {
    out = canvas.toDataURL(mime, q);
    if (Math.round((out.length - out.indexOf(',') - 1) * 0.75) <= maxBytes) break;
  }
  return { data_url: out, bytes: Math.round((out.length - out.indexOf(',') - 1) * 0.75), mime };
}
