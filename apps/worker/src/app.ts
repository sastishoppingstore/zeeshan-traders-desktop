/** One Hono app: public site, ERP SPA, /api/v1 API, sitemap, media, security headers. */
import { Hono } from 'hono';
import type { AppEnv, AppVars } from './context.js';
import { makeDb, requireAuth, fail, nowIso, karachiToday } from './context.js';
import { registerAuth } from './routes/auth.js';
import { registerCatalogue } from './routes/catalogue.js';
import { registerTransactions } from './routes/transactions.js';
import { registerReports } from './routes/reports.js';
import { registerWebsite } from './routes/website.js';
import { registerCheckout } from './routes/checkout.js';
import { registerOps } from './routes/ops.js';
import { registerPasskeys } from './routes/passkeys.js';
import { socialHtml } from './services/social.js';

type H = Hono<{ Bindings: AppEnv; Variables: AppVars }>;

const PUBLIC_PATHS = [
  '/api/v1/setup', '/api/v1/setup/status', '/api/v1/auth/login',
  '/api/v1/health', '/api/v1/features',
  '/api/v1/auth/passkey/authenticate/options', '/api/v1/auth/passkey/authenticate/verify',
];

function securityHeaders(c: any) {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  // The Arena preview embeds the app in a cross-origin iframe; allow it locally only.
  const preview = c.env.LOCAL_PREVIEW === '1';
  c.header('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
    "img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors " +
    (preview ? '*' : "'self'"));
  if (new URL(c.req.url).protocol === 'https:') c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function createApp(): H {
  const app = new Hono<{ Bindings: AppEnv; Variables: AppVars }>();

  app.use('*', async (c, next) => {
    c.set('db', makeDb(c.env));
    securityHeaders(c);
    await next();
    // Usage meter: one indexed upsert per request, counted AFTER the response work.
    try {
      const db = c.get('db')!;
      const reads = db.stats.reads, writes = db.stats.writes;
      const isPublic = c.req.path.startsWith('/api/v1/public');
      const cached = (c.res.headers.get('X-ZT-Cache') === 'HIT') ? 1 : 0;
      const day = karachiToday();
      await db.prepare(`INSERT INTO usage_counters (day,rows_read,rows_written,public_hits,cached_public_hits,updated_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET
          rows_read=rows_read+excluded.rows_read, rows_written=rows_written+excluded.rows_written,
          public_hits=public_hits+excluded.public_hits, cached_public_hits=cached_public_hits+excluded.cached_public_hits,
          updated_at=excluded.updated_at`)
        .bind(day, reads, writes, isPublic ? 1 : 0, cached, nowIso()).run();
    } catch (e) { console.warn('usage meter skipped:', e instanceof Error ? e.message : e); }
  });

  // Deny-by-default auth on every /api/v1 route except explicitly public ones.
  app.use('/api/v1/*', async (c, next) => {
    const path = c.req.path;
    if (path.startsWith('/api/v1/public/') || PUBLIC_PATHS.includes(path)) return next();
    return requireAuth(c, next);
  });

  app.get('/api/v1/health', (c) => c.json({ ok: true, data: { service: 'zeeshan-traders', at: nowIso(),
    runtime: c.env.__ZT_SQLITE__ ? 'local-preview (node:sqlite)' : 'cloudflare-worker' } }));

  registerAuth(app);
  registerPasskeys(app);
  registerCatalogue(app);
  registerTransactions(app);
  registerReports(app);
  registerWebsite(app);
  registerCheckout(app);
  registerOps(app);

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return fail(c, 404, 'NOT_FOUND', 'یہ API راستہ موجود نہیں ہے', 'API route not found');
    return c.html('<!doctype html><html lang="ur" dir="rtl"><meta charset="utf-8"><title>صفحہ نہیں ملا</title><body style="font-family:system-ui;padding:48px;text-align:center"><h1>۴۰۴ — صفحہ نہیں ملا</h1><p>یہ صفحہ موجود نہیں ہے۔</p><a href="/">ہوم</a></body></html>', 404);
  });
  app.onError((err, c) => {
    console.error('[ZT FATAL]', err);
    return fail(c, 500, 'INTERNAL_ERROR', 'سرور میں خرابی', err instanceof Error ? err.message : String(err));
  });

  // Static assets: Cloudflare ASSETS binding, or local dist dir in preview mode.
  app.get('*', async (c) => {
    const path = c.req.path;
    if (c.env.ASSETS) {
      const res = await c.env.ASSETS.fetch(c.req.raw);
      if (!(res.headers.get('content-type') ?? '').includes('text/html')) {
        if (path.startsWith('/assets/') || path.startsWith('/fonts/') || path.startsWith('/icons/') || path.startsWith('/images/') || path.startsWith('/brand/')) {
          const h = new Headers(res.headers);
          h.set('Cache-Control', 'public, max-age=31536000, immutable');
          return new Response(res.body, { status: res.status, headers: h });
        }
        return res;
      }
      const html = await socialHtml(c.get('db')!, new URL(c.req.url).origin, path, await res.text());
      return new Response(html, { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    const dir = (c.env as any).__ZT_STATIC_DIR__ as string | undefined;
    if (!dir) return c.text('Static assets not bound', 501);
    const fs = await import('node:fs/promises');
    const nodePath = await import('node:path');
    const safe = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    let file = nodePath.join(dir, safe);
    let contentType = mime(safe);
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = nodePath.join(file, 'index.html');
    } catch {
      // SPA fallback (public + /erp routes). API paths must NOT fall back to HTML.
      if (path.startsWith('/api/') || path.startsWith('/media/')) return c.text('Not found', 404);
      file = nodePath.join(dir, 'index.html');
      contentType = 'text/html; charset=utf-8';
    }
    try {
      const buf = await fs.readFile(file);
      const headers: Record<string, string> = { 'Content-Type': contentType };
      if (safe.startsWith('assets/') || safe.includes('.woff2')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      else headers['Cache-Control'] = 'no-cache';
      if (!contentType.includes('text/html')) return c.body(buf, 200, headers);
      const html = await socialHtml(c.get('db')!, new URL(c.req.url).origin, path, buf.toString('utf8'));
      return c.body(html, 200, headers);
    } catch {
      return c.text('Build the web app first: npm run build:web', 503);
    }
  });
  return app;
}

function mime(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  return ({
    html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
    woff2: 'font/woff2', woff: 'font/woff', txt: 'text/plain; charset=utf-8',
    webmanifest: 'application/manifest+json', xml: 'application/xml',
  } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}
