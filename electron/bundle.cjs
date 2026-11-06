/**
 * Serving the built renderer to the window, and nothing else.
 *
 * The desktop bundle is loaded from a private `zt-app://` scheme rather than `file://` for two
 * reasons that are both visible to a shop as a blank window if ignored:
 *
 *   · An ES module is fetched in CORS mode. A `file://` document has an opaque origin, so Chromium
 *     can refuse the very `<script type="module">` the bundle is built as. A registered scheme has a
 *     real origin, and the fetch is ordinary.
 *   · The app's own absolute URLs — `/assets/index-*.js`, `/brand/logo-96.webp` — mean "under the
 *     bundle root" to a web server and "the root of the drive" to `file://`. A scheme handler makes
 *     the first reading true.
 *
 * This module is the pure half of that: path mapping and content types, with no Electron in sight, so
 * the traversal rules are checked by `electron/verify-offline.cjs` instead of by a Windows runner.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const SCHEME = 'zt-app';
const HOST = 'bundle';
const ORIGIN = `${SCHEME}://${HOST}`;

/** What the bundle folder actually contains, keyed by extension. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const win = process.platform === 'win32';
const same = (a, b) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
const startsWith = (a, b) => (win ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b));

/**
 * Map one URL pathname to a file inside `root`, or to null when it escapes.
 *
 * `..`, encoded `..`, backslashes on Windows and a symlink out of `out/` all end up outside the root
 * after `path.resolve`, and the containment test is what says so — the renderer is trusted with the
 * ERP but not with the shop's `Documents`.
 *
 * @param {string} root absolute path to the built bundle (…/out)
 * @param {string} urlPath the pathname part of the request URL
 */
function resolveBundlePath(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(String(urlPath ?? '/')); } catch (e) { return null; }   // %zz
  if (decoded.includes('\0')) return null;
  // On POSIX a `\` is an ordinary filename character, so only Windows path separators are rewritten.
  const normalised = win ? decoded.replace(/\\/g, '/') : decoded;
  if (!normalised.startsWith('/')) return null;
  const rel = normalised.replace(/^\/+/, '');
  const full = path.resolve(root, rel === '' ? 'index.html' : rel);
  const rootAbs = path.resolve(root) + path.sep;
  if (!startsWith(full, rootAbs)) return null;                // outside out/ — or the directory itself
  return full;
}

/** A hash router never asks the server for a route, so a miss has no reason to be answered by index.html. */
const isPageRequest = (urlPath) => {
  const p = String(urlPath ?? '/').split('?')[0];
  return p === '/' || p === '' || path.extname(p) === '' || /\.html$/i.test(p);
};

/**
 * Read one bundle file. Returns {status, body, content_type} — never throws, because a missing chunk
 * must show up as a 404 in the logs rather than as an exception inside the protocol handler.
 */
function readBundleFile(root, urlPath, { allowIndexFallback = true } = {}) {
  const full = resolveBundlePath(root, urlPath);
  if (!full) return { status: 403, body: Buffer.from('Forbidden'), content_type: 'text/plain; charset=utf-8' };
  try {
    const body = fs.readFileSync(full);
    return { status: 200, body, content_type: MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream' };
  } catch (e) {
    if (allowIndexFallback && isPageRequest(urlPath)) {
      const index = path.resolve(root, 'index.html');
      try {
        return { status: 200, body: fs.readFileSync(index), content_type: MIME['.html'] };
      } catch { /* fall through to the honest 404 */ }
    }
    return { status: 404, body: Buffer.from('Not found'), content_type: 'text/plain; charset=utf-8' };
  }
}

/** The URL the window should open: the bundle's index, landing on the ERP and not on the storefront. */
function entryUrl(entry = 'index.html', hash = '/erp') {
  return `${ORIGIN}/${String(entry).replace(/^\/+/, '')}#${hash}`;
}

module.exports = { SCHEME, HOST, ORIGIN, MIME, resolveBundlePath, readBundleFile, entryUrl, isPageRequest };
