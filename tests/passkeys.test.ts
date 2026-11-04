/** A15 WebAuthn passkeys: one-time challenges, expiry, replay, user binding and route guards. */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { storeChallenge, consumeChallenge, recoverChallenge } from '../apps/worker/src/routes/passkeys.js';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { makeDb } from '../apps/worker/src/context.js';

const clientData = (challenge: string) => isoBase64URL.fromBuffer(
  new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://zt.test' })));

describe('WebAuthn challenge lifecycle (real SQL)', () => {
  it('recovers the challenge from clientDataJSON', () => {
    expect(recoverChallenge({ response: { clientDataJSON: clientData('abc-123') } })).toBe('abc-123');
    expect(recoverChallenge({})).toBe('');
  });

  it('is single-use: a replayed challenge is rejected', async () => {
    const h = makeHarness();
    await h.setup();
    const user = h.sqlite.prepare('SELECT id FROM users LIMIT 1').get() as { id: string };
    await storeChallenge(makeDb(h.env), 'CH-1', 'REGISTER', user.id);
    expect(await consumeChallenge(makeDb(h.env), 'CH-1', 'REGISTER', user.id)).toBe(true);
    expect(await consumeChallenge(makeDb(h.env), 'CH-1', 'REGISTER', user.id)).toBe(false);
  });

  it('binds REGISTER challenges to their user and rejects expired / wrong-kind challenges', async () => {
    const h = makeHarness();
    await h.setup();
    const user = h.sqlite.prepare('SELECT id FROM users LIMIT 1').get() as { id: string };
    await storeChallenge(makeDb(h.env), 'CH-2', 'REGISTER', user.id);
    expect(await consumeChallenge(makeDb(h.env), 'CH-2', 'REGISTER', 'someone-else')).toBe(false);
    expect(await consumeChallenge(makeDb(h.env), 'CH-2', 'AUTHENTICATE', null)).toBe(false);
    expect(await consumeChallenge(makeDb(h.env), 'CH-2', 'REGISTER', user.id)).toBe(true);
    await storeChallenge(makeDb(h.env), 'CH-3', 'AUTHENTICATE', null);
    h.sqlite.prepare('UPDATE webauthn_challenges SET expires_at=? WHERE challenge=?')
      .run(new Date(Date.now() - 1000).toISOString(), 'CH-3');
    expect(await consumeChallenge(makeDb(h.env), 'CH-3', 'AUTHENTICATE', null)).toBe(false);
  });

  it('authentication options are public; registration requires a session; the 501 stub is gone', async () => {
    const h = makeHarness();
    const anon = await h.call('POST', '/api/v1/auth/passkey/authenticate/options', {});
    expect(anon.status).toBe(200);
    expect(typeof anon.json.data.options.challenge).toBe('string');
    const regAnon = await h.call('POST', '/api/v1/auth/passkey/register/options', {});
    expect(regAnon.status).toBe(401);
    expect(regAnon.json.error.code).not.toBe('INCOMPLETE_PASSKEYS');
    await h.setup();
    const reg = await h.call('POST', '/api/v1/auth/passkey/register/options', {});
    expect(reg.status).toBe(200);
    expect(reg.json.data.options.rp.id).toBe('zt.test');
    const list = await h.call('GET', '/api/v1/auth/passkeys');
    expect(list.status).toBe(200);
    expect(list.json.data).toEqual([]);
  });
});
