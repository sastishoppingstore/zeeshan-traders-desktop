/* Zeeshan Traders service worker — offline PWA (spec 8.1).
 * App shell + fonts + public catalogue are cached. Private/money APIs are NEVER cached.
 * Background Sync is not available on iOS Safari/Firefox, so the app also syncs on
 * open, on 'online', on a visibility timer and via the manual "Sync Now" button.
 */
const CACHE = 'zt-shell-v12';
const SHELL = [
  '/', '/erp', '/index.html', '/manifest.webmanifest',
  '/brand/logo-96.webp', '/brand/logo-96.png',
  '/icons/icon-32.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/fonts/naskh-400.woff2', '/fonts/naskh-600.woff2', '/fonts/naskh-700.woff2',
  '/fonts/nastaliq-700.woff2', '/fonts/inter-400.woff2', '/fonts/inter-600.woff2', '/fonts/inter-700.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => undefined)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated/private endpoints or money data.
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/public/')) return;

  // Public catalogue: stale-while-revalidate (edge cache is primary; this is the offline fallback).
  if (url.pathname.startsWith('/api/v1/public/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => undefined);
          return res;
        }).catch(() => null);
        return cached || (await network) || new Response(JSON.stringify({ ok: false, error: { code: 'OFFLINE', message_ur: 'آف لائن', message_en: 'Offline' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    return;
  }

  // Static assets, fonts, icons and the site photography: cache-first (immutable, works offline).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')
    || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/images/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  // Navigations: network-first with offline shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put('/index.html', res.clone()));
        return res;
      }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) ||
        new Response('<html lang="ur" dir="rtl"><meta charset="utf-8"><body style="font-family:system-ui;padding:48px"><h1>آف لائن</h1><p>یہ صفحہ ابھی کیش نہیں ہوا۔</p><a href="/erp">کھاتہ کھولیں</a></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
    );
  }
});
