/** Offline PIN cache crypto: PBKDF2 >=310,000 + AES-256-GCM, no plaintext at rest. */
import { describe, it, expect } from 'vitest';
import {
  PIN_ITERATIONS, VERIFY_PLAINTEXT, derivePinKey, encryptJson, decryptJson,
  isEnc, b64, unb64,
} from '../apps/web/src/pin-crypto.js';

const salt = () => crypto.getRandomValues(new Uint8Array(16));

describe('PIN-derived offline cache encryption', () => {
  it('uses at least 310,000 PBKDF2 iterations and a 256-bit AES-GCM key', async () => {
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(310_000);
    const key = await derivePinKey('4821', salt());
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as any).length).toBe(256);
    expect(key.extractable).toBe(false);
  });

  it('round-trips an Urdu role-scoped cache row and never keeps plaintext in the blob', async () => {
    const key = await derivePinKey('938204', salt());
    const row = { kind: 'products', data: [{ name_ur: 'ڈی اے پی کھاد', rate_paisa: 250000 }] };
    const blob = await encryptJson(key, row);
    expect(isEnc(blob)).toBe(true);
    expect(JSON.stringify(blob)).not.toContain('ڈی اے پی');
    expect(JSON.stringify(blob)).not.toContain('250000');
    expect(await decryptJson(key, blob)).toEqual(row);
  });

  it('a different PIN or salt cannot decrypt the cache (verifier check)', async () => {
    const s = salt();
    const right = await derivePinKey('123456', s);
    const wrong = await derivePinKey('123457', s);
    const verifier = await encryptJson(right, VERIFY_PLAINTEXT);
    await expect(decryptJson(wrong, verifier)).rejects.toThrow();
    expect(await decryptJson(right, verifier)).toBe(VERIFY_PLAINTEXT);
    const otherSalt = await derivePinKey('123456', salt());
    await expect(decryptJson(otherSalt, verifier)).rejects.toThrow();
  });

  it('a fresh 12-byte IV per encryption means identical plaintext yields different ciphertext', async () => {
    const key = await derivePinKey('7777', salt());
    const a = await encryptJson(key, { x: 1 });
    const b = await encryptJson(key, { x: 1 });
    expect(unb64(a.iv)).toHaveLength(12);
    expect(a.ct).not.toBe(b.ct);
    expect(b64(unb64(a.ct))).toBe(a.ct);
  });
});
