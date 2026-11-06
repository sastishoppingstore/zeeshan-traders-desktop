/**
 * Bake the API origin into the installer.
 *
 * `DESKTOP_API_URL` is a *build-time* variable, but the shell reads its configuration at
 * *runtime* (see electron/config.cjs). Without this step the packaged app only has the
 * placeholder written by ensureConfigTemplate() and sync never connects until the shop's owner
 * edits %APPDATA%/…/config.json by hand. Writing a small JSON file next to the renderer puts the
 * value inside out/**, which electron-builder already packs, and config.cjs reads it as the
 * lowest-precedence fallback.
 *
 *   node scripts/write-desktop-config.mjs            # dev/build: skip when unset
 *   node scripts/write-desktop-config.mjs --required # dist:win / CI: fail when unset
 *
 * No secret is involved: the Worker origin is public and already appears in the web bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'out');
const required = process.argv.includes('--required');
const raw = (process.env.DESKTOP_API_URL ?? '').trim();

function fail(message) {
  process.stderr.write(`write-desktop-config: ${message}\n`);
  process.exit(1);
}

if (!raw) {
  const message = 'DESKTOP_API_URL is not set — the installer would have no API origin';
  if (required) fail(`${message}. Set it before packaging, e.g. DESKTOP_API_URL=https://api.example.com npm run dist:win`);
  process.stdout.write(`write-desktop-config: ${message}; skipping (not required for this build)\n`);
  process.exit(0);
}

let url;
try {
  url = new URL(raw);
} catch {
  fail(`DESKTOP_API_URL is not a valid URL: ${raw}`);
}
if (url.protocol !== 'https:' && url.protocol !== 'http:') {
  fail(`DESKTOP_API_URL must be http(s), got ${url.protocol}`);
}
if (/REPLACE-WITH/i.test(raw)) fail('DESKTOP_API_URL is still the placeholder value');

const origin = url.origin + (url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '');

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, 'desktop-config.json');
fs.writeFileSync(file, `${JSON.stringify({
  api_base_url: origin,
  baked_at: new Date().toISOString(),
  note: 'Generated at build time from DESKTOP_API_URL. An operator override in <userData>/config.json and the DESKTOP_API_URL env var both take precedence at runtime.',
}, null, 2)}\n`, 'utf8');

process.stdout.write(`write-desktop-config: baked ${origin} into ${path.relative(ROOT, file)}\n`);
