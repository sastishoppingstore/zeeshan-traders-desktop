/** IDs, hashing, tokens and column-level AES-GCM encryption (WebCrypto: Workers + Node 22). */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Time-sorted ULID-like id; 26 chars, lexicographically sortable. */
export function ulid(now = Date.now()): string {
  let t = BigInt(now);
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[Number(t % 32n)] + time;
    t /= 32n;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] & 31];
  return time + rand;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  // Secret is a base64 32-byte key (DATA_ENCRYPTION_KEY).
  let raw: Uint8Array;
  try {
    raw = fromBase64(secret);
  } catch {
    raw = new TextEncoder().encode(secret.padEnd(32, '0').slice(0, 32));
  }
  if (raw.length !== 32) {
    const hash = await crypto.subtle.digest('SHA-256', raw as any);
    raw = new Uint8Array(hash);
  }
  return crypto.subtle.importKey('raw', raw as any, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(plaintext: string, secret: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await aesKey(secret);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as any }, key, new TextEncoder().encode(plaintext) as any);
  return toBase64(new Uint8Array([...iv, ...new Uint8Array(cipher)]));
}

export async function decryptText(payload: string, secret: string): Promise<string> {
  const all = fromBase64(payload);
  const iv = all.slice(0, 12);
  const data = all.slice(12);
  const key = await aesKey(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as any }, key, data as any);
  return new TextDecoder().decode(plain);
}

/** PBKDF2-SHA256 with >=310,000 iterations (spec 2.1 / H7). */
export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const iterations = 310_000;
  const saltB64 = salt ?? toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as any, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltB64) as any, iterations },
    key,
    256,
  );
  return { hash: toBase64(new Uint8Array(bits)), salt: saltB64, iterations };
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations = 310_000): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as any, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as any, iterations },
    key,
    256,
  );
  const candidate = toBase64(new Uint8Array(bits));
  // constant-time-ish comparison
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export function karachiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function karachiNowIso(): string {
  return new Date().toISOString();
}

export function periodYM(date: string): string {
  return date.slice(0, 7);
}

/** Online document number: PREFIX-YYYY-000001 (gapless per sequence, assigned in the posting batch). */
export function seqNumber(prefix: string, value: number): string {
  return `${prefix}-${new Date().getUTCFullYear()}-${String(value).padStart(6, '0')}`;
}
