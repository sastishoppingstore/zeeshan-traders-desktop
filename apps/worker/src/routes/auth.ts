/** Setup wizard, password auth, sessions, CSRF, users/roles/devices/passkeys. */
import type { Hono } from 'hono';
import type { AppEnv, AppVars } from '../context.js';
import {
  ok, fail, handle, me, getSetting, setSetting,
  createSession, cookieValue, sessionCookies, clientIp, rateLimit, audit, nowIso,
  requirePerm, BizError,
} from '../context.js';
import { loginSchema, setupSchema, roleSchema, ulid, ROLES, BUSINESS_PROFILE,
  hashPassword, verifyPassword, sha256 } from '@zt/shared';
import { postAccountOpening } from '../services/inventory.js';
import type { DB } from '../db.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

function timingSafe(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function setupComplete(db: DB): Promise<boolean> {
  return (await getSetting<boolean>(db, 'setup_complete')) === true;
}

export function registerAuth(app: H) {
  app.get('/api/v1/setup/status', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const complete = await setupComplete(db);
    const ownerCount = await db.prepare('SELECT COUNT(*) n FROM users').first<{ n: number }>();
    const data: Record<string, unknown> = {
      setup_complete: complete,
      owner_exists: ownerCount?.n ? true : false,
      business: BUSINESS_PROFILE,
      local_preview: c.env.LOCAL_PREVIEW === '1',
    };
    // Local preview only: never exposed when a real SETUP_TOKEN secret is deployed.
    if (!complete && c.env.EXPOSE_SETUP_TOKEN === '1' && c.env.SETUP_TOKEN) {
      data.setup_token = c.env.SETUP_TOKEN;
      data.token_note = 'LOCAL PREVIEW ONLY — production uses a secret printed at deploy time';
    }
    return ok(c, data);
  }));

  app.post('/api/v1/setup', (c) => handle(c, async () => {
    const db = c.get('db')!;
    if (await setupComplete(db)) throw new BizError(409, 'SETUP_ALREADY_DONE', 'سیٹ اپ مکمل ہو چکا ہے، دوبارہ نہیں چل سکتا', 'Setup cannot be re-run');
    const body = setupSchema.parse(await c.req.json());
    const expected = c.env.SETUP_TOKEN;
    if (!expected) throw new BizError(503, 'SETUP_TOKEN_MISSING', 'سیٹ اپ ٹوکن ترتیب نہیں دیا گیا', 'SETUP_TOKEN secret is not configured');
    if (!timingSafe(body.setup_token, expected)) throw new BizError(403, 'INVALID_SETUP_TOKEN', 'سیٹ اپ ٹوکن غلط ہے', 'Invalid setup token');
    const exists = await db.prepare('SELECT id FROM users LIMIT 1').first();
    if (exists) throw new BizError(409, 'SETUP_ALREADY_DONE', 'صارف پہلے سے موجود ہے', 'A user already exists');
    const pw = await hashPassword(body.owner.password);
    const userId = ulid();
    const at = nowIso();
    await db.batch([
      db.prepare(`INSERT INTO users (id,username,display_name,mobile,password_hash,password_salt,iterations,status,created_at,created_by,updated_at,version)
        VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?,1)`).bind(
        userId, body.owner.username, body.owner.name, body.owner.mobile,
        pw.hash, pw.salt, pw.iterations, at, 'setup', at),
      db.prepare('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)').bind(userId, 'role-owner'),
    ]);
    if (body.business) {
      const stored = await getSetting<any>(db, 'business') ?? {};
      await setSetting(db, 'business', { ...stored, ...body.business }, userId);
    }
    await setSetting(db, 'maund_kg', body.maund_kg, userId);
    await setSetting(db, 'maund_confirmed', true, userId);
    await setSetting(db, 'fiscal_year', { start_month: body.fiscal_start_month, start_day: 1 }, userId);
    if (body.prefixes) {
      const current = (await getSetting<Record<string, string>>(db, 'numbering_prefixes')) ?? {};
      await setSetting(db, 'numbering_prefixes', { ...current, ...body.prefixes }, userId);
      for (const [code, prefix] of Object.entries(body.prefixes)) {
        await db.prepare('UPDATE invoice_sequences SET prefix=?, updated_at=? WHERE code=?').bind(prefix, at, code).run();
      }
    }
    if (body.regulatory) {
      for (const [key, value] of Object.entries(body.regulatory)) {
        if (value !== undefined) await setSetting(db, key, value, userId);
      }
    }
    for (const ob of body.opening_balances) {
      if (ob.amount_paisa !== 0) {
        await postAccountOpening(c, { account_code: ob.account_code, amount_paisa: Math.abs(ob.amount_paisa),
          as_of_date: ob.as_of_date, direction: ob.direction });
      }
    }
    await setSetting(db, 'setup_complete', true, userId);
    await audit(db, 'SETUP', 'business_settings', 'setup', { user_id: userId, after: { owner: body.owner.username, maund_kg: body.maund_kg } });
    const session = await createSession(db, userId, null, clientIp(c));
    for (const cookie of sessionCookies(c, session.token, session.csrf, session.expires)) c.header('Set-Cookie', cookie, { append: true });
    return ok(c, { user_id: userId, csrf: session.csrf, setup_complete: true }, 201);
  }));

  app.post('/api/v1/auth/login', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const ip = clientIp(c);
    if (!(await rateLimit(db, `login:${ip}`, 10, 15 * 60_000))) {
      throw new BizError(429, 'RATE_LIMITED', 'بہت زیادہ کوششیں، 15 منٹ بعد کوشش کریں', 'Too many attempts; try again in 15 minutes');
    }
    const body = loginSchema.parse(await c.req.json());
    const user = await db.prepare('SELECT * FROM users WHERE username=? OR mobile=?').bind(body.username, body.username).first<any>();
    if (!user) {
      await audit(db, 'LOGIN_FAILED', 'users', null, { ip });
      throw new BizError(401, 'INVALID_CREDENTIALS', 'صارف نام یا پاس ورڈ غلط ہے', 'Invalid credentials');
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new BizError(423, 'LOCKED', 'پانچ غلط کوششوں کے بعد اکاؤنٹ 15 منٹ کے لیے بند ہے', 'Account locked for 15 minutes');
    }
    if (user.status !== 'ACTIVE') throw new BizError(403, 'DISABLED', 'یہ اکاؤنٹ بند ہے', 'Account disabled');
    const valid = await verifyPassword(body.password, user.password_hash, user.password_salt, user.iterations);
    if (!valid) {
      const attempts = user.failed_attempts + 1;
      const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?').bind(attempts, lock, user.id).run();
      await audit(db, 'LOGIN_FAILED', 'users', user.id, { ip });
      throw new BizError(401, 'INVALID_CREDENTIALS', 'صارف نام یا پاس ورڈ غلط ہے', 'Invalid credentials');
    }
    await db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?').bind(user.id).run();
    const session = await createSession(db, user.id, body.device_id ?? null, ip);
    for (const cookie of sessionCookies(c, session.token, session.csrf, session.expires)) c.header('Set-Cookie', cookie, { append: true });
    await audit(db, 'LOGIN', 'users', user.id, { ip });
    return ok(c, { user_id: user.id, csrf: session.csrf, name: user.display_name });
  }));

  app.post('/api/v1/auth/logout', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const token = cookieValue(c, 'zt_session');
    if (token) await db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(nowIso(), await sha256(token)).run();
    const u = c.get('user');
    await audit(db, 'LOGOUT', 'users', u?.id ?? null, {});
    for (const name of ['zt_session', 'zt_csrf', 'zt_expires']) {
      c.header('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`, { append: true });
    }
    return ok(c, { logged_out: true });
  }));

  app.get('/api/v1/auth/me', (c) => handle(c, async () => {
    const db = c.get('db')!;
    const user = c.get('user');
    if (!user) return fail(c, 401, 'UNAUTHENTICATED', 'لاگ ان ضروری ہے', 'Login required');
    const business = await getSetting(db, 'business');
    return ok(c, { user, business, setup_complete: await setupComplete(db), permissions: user.permissions });
  }));

  // WebAuthn passkey routes are registered by registerPasskeys() in app.ts.

  app.get('/api/v1/roles', requirePerm('users.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare('SELECT code,name_ur,name_en FROM roles ORDER BY code').all();
    const perms = await db.prepare('SELECT role_id,permission_code FROM role_permissions').all();
    return ok(c, { roles: ROLES.map((r) => ({ ...r, perms: r.perms })), stored: rows, matrix: perms });
  }));

  app.get('/api/v1/users', requirePerm('users.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const rows = await db.prepare(`SELECT u.id,u.username,u.display_name,u.mobile,u.status,u.created_at,
      (SELECT GROUP_CONCAT(r.code) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id) roles
      FROM users u ORDER BY u.created_at DESC LIMIT 100`).all();
    return ok(c, rows);
  }));

  app.post('/api/v1/users', requirePerm('users.write'), (c) => handle(c, async () => {
    const body = roleSchema.parse(await c.req.json());
    const db = c.get('db')!;
    const pw = await hashPassword(body.password);
    const id = ulid(); const at = nowIso();
    const stmts: any[] = [
      db.prepare(`INSERT INTO users (id,username,display_name,mobile,password_hash,password_salt,iterations,status,created_at,created_by,updated_at,version)
        VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?,1)`).bind(id, body.username, body.name, body.mobile,
        pw.hash, pw.salt, pw.iterations, at, me(c).id, at),
    ];
    for (const code of body.role_codes) {
      stmts.push(db.prepare('INSERT INTO user_roles (user_id,role_id) VALUES (?,?)').bind(id, `role-${code.toLowerCase()}`));
    }
    await db.batch(stmts);
    await audit(db, 'CREATE', 'users', id, { user_id: me(c).id, after: { username: body.username, roles: body.role_codes } });
    return ok(c, { id }, 201);
  }));

  app.post('/api/v1/users/:id/disable', requirePerm('users.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const id = c.req.param('id');
    await db.prepare('UPDATE users SET status=?,updated_at=? WHERE id=?').bind('DISABLED', nowIso(), id).run();
    await db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=?').bind(nowIso(), id).run();
    await audit(db, 'DISABLE', 'users', id, { user_id: me(c).id });
    return ok(c, { id, status: 'DISABLED' });
  }));

  app.post('/api/v1/users/:id/reset-password', requirePerm('users.write'), (c) => handle(c, async () => {
    const body = await c.req.json() as { password?: string };
    if (!body.password || body.password.length < 10) throw new BizError(400, 'WEAK_PASSWORD', 'پاس ورڈ کم از کم 10 حروف کا ہو', 'Password must be at least 10 characters');
    const db = c.get('db')!;
    const pw = await hashPassword(body.password);
    await db.prepare('UPDATE users SET password_hash=?,password_salt=?,iterations=?,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?')
      .bind(pw.hash, pw.salt, pw.iterations, nowIso(), c.req.param('id')).run();
    await audit(db, 'RESET_PASSWORD', 'users', c.req.param('id'), { user_id: me(c).id });
    return ok(c, { reset: true });
  }));

  app.get('/api/v1/devices', requirePerm('users.read'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    return ok(c, await db.prepare('SELECT * FROM devices ORDER BY registered_at DESC LIMIT 100').all());
  }));

  app.post('/api/v1/devices/:id/revoke', requirePerm('users.write'), (c) => handle(c, async () => {
    const db = c.get('db')!;
    const id = c.req.param('id');
    await db.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(nowIso(), id).run();
    await audit(db, 'REVOKE_DEVICE', 'devices', id, { user_id: me(c).id });
    return ok(c, { id, revoked: true });
  }));
}
