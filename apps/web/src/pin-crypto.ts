/** Pure WebCrypto primitives for the optional offline PIN cache encryption.
 *  No DOM/IndexedDB dependency, so these are unit-testable in Node's WebCrypto. */
export const PIN_ITERATIONS = 310_000;
export const VERIFY_PLAINTEXT = 'ZT_PIN_OK_v1';

export interface EncBlob { __zt_enc: 1; iv: string; ct: string }
export const isEnc = (v: unknown): v is EncBlob => !!v && typeof v === 'object' && (v as any).__zt_enc === 1;
export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin) as BufferSource,
    'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: PIN_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key,
    new TextEncoder().encode(JSON.stringify(value)) as BufferSource);
  return { __zt_enc: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decryptJson(key: CryptoKey, blob: EncBlob): Promise<unknown> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) as BufferSource }, key,
    unb64(blob.ct) as BufferSource);
  return JSON.parse(new TextDecoder().decode(pt));
}
