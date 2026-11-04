/** WebAuthn passkeys (Part 8.2, A15). Real @simplewebauthn/server verification.
 *
 *  The site NEVER sees a fingerprint/biometric: the authenticator signs a one-time
 *  challenge locally, we store only the credential public key + signature counter.
 *  RP ID / origin are env-driven: decide the final domain BEFORE enrolling devices
 *  (passkeys are domain-bound). Local preview defaults to localhost for E2E tests.
 */
import type { Hono } from 'hono';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { ulid } from '@zt/shared';
import type { AppEnv, AppVars } from '../context.js';
import type { DB } from '../db.js';
import {
  ok, handle, nowIso, audit, clientIp, rateLimit,
  createSession, sessionCookies, BizError,
} from '../context.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

const CHALLENGE_TTL_MS = 5 * 60_000;

function rp(c: any): { origin: string; rpID: string; name: string } {
  const url = new URL(c.req.url);
  return {
    origin: c.env.RP_ORIGIN || url.origin,
    rpID: c.env.RP_ID || url.hostname,
    name: c.env.RP_NAME || 'ذیشان ٹریڈرز',
  };
}

export async function storeChallenge(db: DB, challenge: string, kind: string, userId: string | null) {
  const at = nowIso();
  await db.prepare(`INSERT INTO webauthn_challenges (challenge,user_id,kind,created_at,expires_at,used_at)
    VALUES (?,?,?,?,?,NULL)`)
    .bind(challenge, userId, kind, at, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString()).run();
}

/** Consume a challenge exactly once. Returns false when missing/expired/replayed/wrong kind. */
export async function consumeChallenge(db: DB, challenge: string, kind: string, userId: string | null): Promise<boolean> {
  const row = await db.prepare('SELECT * FROM webauthn_challenges WHERE challenge=?').bind(challenge).first<any>();
  if (!row || row.kind !== kind || row.used_at) return false;
  if (userId !== null && row.user_id !== userId) return false;
  if (userId === null && row.user_id !== null) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  const changed = await db.prepare('UPDATE webauthn_challenges SET used_at=? WHERE challenge=? AND used_at IS NULL')
    .bind(nowIso(), challenge).run();
  return changed.changes === 1;
}

export function registerPasskeys(app: H) {
  // ---------------- Registration (authenticated; CSRF enforced by requireAuth) ----------------
  app.post('/api/v1/auth/passkey/register/options', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const user = c.get('user')!;
    const { origin, rpID, name } = rp(c);
    const existingRaw = await db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id=? AND revoked_at IS NULL')
      .bind(user.id).all<any>();
    const existing = existingRaw as any[];
    const options = await generateRegistrationOptions({
      rpName: name, rpID,
      userID: new TextEncoder().encode(user.id) as any,
      userName: user.username,
      userDisplayName: (user as any).name ?? user.username,
      attestationType: 'none',
      excludeCredentials: existing.map((r) => ({
        id: r.credential_id,
        ...(r.transports ? { transports: JSON.parse(r.transports) } : {}),
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await storeChallenge(db, options.challenge, 'REGISTER', user.id);
    return ok(c, { options, rp_id: rpID, origin });
  }));

  app.post('/api/v1/auth/passkey/register/verify', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const user = c.get('user')!;
    const { origin, rpID } = rp(c);
    const body = await c.req.json() as any;
    const response = body?.response ?? body;
    const challenge: string = response?.clientDataJSON
      ? '' // challenge is taken from the stored row below, verified via callback
      : (body?.challenge ?? '');
    // The browser does not echo the challenge in clear text; recover it from clientDataJSON.
    const recovered = recoverChallenge(response);
    const expected = recovered || challenge;
    if (!expected) {
      throw new BizError(400, 'INVALID_CHALLENGE', 'چیلنج غائب ہے', 'Challenge missing');
    }
    const verification = await verifyRegistrationResponse({
      response: response as any,
      expectedChallenge: expected,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new BizError(400, 'PASSKEY_VERIFY_FAILED', 'پاس کی کی تصدیق ناکام', 'Passkey registration verification failed');
    }
    if (!(await consumeChallenge(db, expected, 'REGISTER', user.id))) {
      throw new BizError(400, 'INVALID_CHALLENGE', 'چیلنج ختم یا دوبارہ استعمال ہوا', 'Challenge expired or replayed');
    }
    const cred = verification.registrationInfo.credential;
    const id = ulid();
    await db.prepare(`INSERT INTO passkeys (id,user_id,credential_id,public_key,counter,transports,created_at,revoked_at)
      VALUES (?,?,?,?,?,?,?,NULL)`)
      .bind(id, user.id, cred.id, isoBase64URL.fromBuffer(cred.publicKey as any), cred.counter,
        JSON.stringify(cred.transports ?? []), nowIso()).run();
    await audit(db, 'PASSKEY_REGISTER', 'passkeys', id, { user_id: user.id, after: { credential_id: cred.id } });
    return ok(c, { id, credential_id: cred.id, verified: true }, 201);
  }));

  // ---------------- Authentication (public, like /auth/login) ----------------
  app.post('/api/v1/auth/passkey/authenticate/options', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const ip = clientIp(c);
    if (!(await rateLimit(db, `passkey:${ip}`, 10, 15 * 60_000))) {
      throw new BizError(429, 'RATE_LIMITED', 'بہت زیادہ کوششیں، 15 منٹ بعد کوشش کریں', 'Too many attempts; try again in 15 minutes');
    }
    const { rpID } = rp(c);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: [], // discoverable credentials: user picks their own passkey
    });
    await storeChallenge(db, options.challenge, 'AUTHENTICATE', null);
    return ok(c, { options, rp_id: rpID });
  }));

  app.post('/api/v1/auth/passkey/authenticate/verify', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const { origin, rpID } = rp(c);
    const body = await c.req.json() as any;
    const response = body?.response ?? body;
    const expected = recoverChallenge(response);
    const credentialId: string = response?.id ?? response?.rawId ?? '';
    if (!expected || !credentialId) {
      throw new BizError(400, 'INVALID_PASSKEY_RESPONSE', 'پاس کی جواب ناقص ہے', 'Malformed passkey response');
    }
    const row = await db.prepare(`SELECT p.*, u.username, u.status FROM passkeys p
      JOIN users u ON u.id=p.user_id WHERE p.credential_id=? AND p.revoked_at IS NULL`)
      .bind(credentialId).first<any>();
    if (!row) throw new BizError(401, 'PASSKEY_NOT_FOUND', 'یہ پاس کی رجسٹرڈ نہیں ہے', 'Passkey not registered or revoked');
    if (row.status !== 'ACTIVE') throw new BizError(403, 'DISABLED', 'یہ اکاؤنٹ بند ہے', 'Account disabled');
    const verification = await verifyAuthenticationResponse({
      response: response as any,
      expectedChallenge: expected,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: row.credential_id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: row.counter,
        transports: row.transports ? JSON.parse(row.transports) : [],
      },
    });
    if (!verification.verified) {
      throw new BizError(401, 'PASSKEY_VERIFY_FAILED', 'پاس کی کی تصدیق ناکام', 'Passkey verification failed');
    }
    if (!(await consumeChallenge(db, expected, 'AUTHENTICATE', null))) {
      throw new BizError(400, 'INVALID_CHALLENGE', 'چیلنج ختم یا دوبارہ استعمال ہوا', 'Challenge expired or replayed');
    }
    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter <= row.counter && newCounter !== 0) {
      throw new BizError(401, 'PASSKEY_REPLAY', 'پاس کی دوبارہ استعمال ہوا', 'Passkey counter replay detected');
    }
    await db.prepare('UPDATE passkeys SET counter=? WHERE id=?').bind(newCounter, row.id).run();
    const session = await createSession(db, row.user_id, (body?.device_id ?? null), clientIp(c));
    for (const cookie of sessionCookies(c, session.token, session.csrf, session.expires)) c.header('Set-Cookie', cookie, { append: true });
    await audit(db, 'LOGIN_PASSKEY', 'users', row.user_id, { ip: clientIp(c), after: { credential_id: credentialId } });
    return ok(c, { user_id: row.user_id, csrf: session.csrf, name: row.username, method: 'passkey' });
  }));

  // ---------------- Management ----------------
  app.get('/api/v1/auth/passkeys', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const user = c.get('user')!;
    const rows = await db.prepare(`SELECT id,credential_id,transports,created_at,revoked_at
      FROM passkeys WHERE user_id=? ORDER BY created_at DESC`).bind(user.id).all<any>();
    return ok(c, rows);
  }));

  app.post('/api/v1/auth/passkeys/:id/revoke', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const user = c.get('user')!;
    const id = c.req.param('id');
    const changed = await db.prepare('UPDATE passkeys SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL')
      .bind(nowIso(), id, user.id).run();
    if (changed.changes !== 1) throw new BizError(404, 'NOT_FOUND', 'پاس کی نہیں ملی', 'Passkey not found');
    await audit(db, 'PASSKEY_REVOKE', 'passkeys', id, { user_id: user.id });
    return ok(c, { revoked: true });
  }));
}

/** Decode clientDataJSON (base64url) and return its challenge. */
export function recoverChallenge(response: any): string {
  try {
    const raw = response?.response?.clientDataJSON ?? response?.clientDataJSON;
    if (!raw) return '';
    const json = JSON.parse(new TextDecoder().decode(isoBase64URL.toBuffer(raw)));
    return typeof json?.challenge === 'string' ? json.challenge : '';
  } catch { return ''; }
}
