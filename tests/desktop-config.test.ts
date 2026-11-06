/**
 * Installing the app must not leave it pointing at nothing.
 *
 * `DESKTOP_API_URL` is consumed at build time (scripts/write-desktop-config.mjs) because the
 * installed app inherits no runner environment. These tests pin the runtime precedence in
 * electron/config.cjs: env > operator config.json > the baked file, with the auto-written
 * placeholder treated as "not set" so an old template cannot shadow a real baked origin.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { loadConfig, ensureConfigTemplate, normaliseBaseUrl } = require(`${ROOT}electron/config.cjs`);

const dirs: string[] = [];
function fixture({ user, baked }: { user?: Record<string, unknown>; baked?: Record<string, unknown> } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cfg-'));
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-app-'));
  dirs.push(userData, appRoot);
  if (user) fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify(user), 'utf8');
  if (baked) {
    fs.mkdirSync(path.join(appRoot, 'out'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'out', 'desktop-config.json'), JSON.stringify(baked), 'utf8');
  }
  return { userData, appRoot };
}
afterEach(() => { while (dirs.length) { try { fs.rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* best effort */ } } });

const API = 'https://zt-v2.example.workers.dev';

describe('desktop API origin precedence', () => {
  it('reads the origin baked into out/desktop-config.json when nothing overrides it', () => {
    const { userData, appRoot } = fixture({ baked: { api_base_url: API } });
    const cfg = loadConfig({ userData, appRoot, env: {} });
    expect(cfg.apiBaseUrl).toBe(API);
    expect(cfg.apiBaseSource).toBe('baked');
    expect(cfg.configError).toBeNull();
  });

  it('lets DESKTOP_API_URL win (a developer run against localhost)', () => {
    const { userData, appRoot } = fixture({ baked: { api_base_url: API } });
    const cfg = loadConfig({ userData, appRoot, env: { DESKTOP_API_URL: 'http://localhost:3000' } });
    expect(cfg.apiBaseUrl).toBe('http://localhost:3000');
    expect(cfg.apiBaseSource).toBe('env');
  });

  it('lets the operator config.json win over the baked origin', () => {
    const { userData, appRoot } = fixture({
      user: { api_base_url: 'https://staging.example.workers.dev' },
      baked: { api_base_url: API },
    });
    const cfg = loadConfig({ userData, appRoot, env: {} });
    expect(cfg.apiBaseUrl).toBe('https://staging.example.workers.dev');
    expect(cfg.apiBaseSource).toBe('user');
  });

  it('ignores a placeholder config.json written by an older build and uses the baked origin', () => {
    const { userData, appRoot } = fixture({
      user: { api_base_url: 'https://REPLACE-WITH-YOUR-WORKER-URL' },
      baked: { api_base_url: API },
    });
    const cfg = loadConfig({ userData, appRoot, env: {} });
    expect(cfg.apiBaseUrl).toBe(API);
    expect(cfg.apiBaseSource).toBe('baked');
  });

  it('reports a configuration error instead of inventing an origin', () => {
    const { userData, appRoot } = fixture();
    const cfg = loadConfig({ userData, appRoot, env: {} });
    expect(cfg.apiBaseUrl).toBeNull();
    expect(cfg.apiBaseError).toMatch(/not set/);
  });

  it('rejects the placeholder in the environment too', () => {
    const { userData, appRoot } = fixture({ baked: { api_base_url: API } });
    const cfg = loadConfig({ userData, appRoot, env: { DESKTOP_API_URL: 'https://REPLACE-WITH-YOUR-WORKER-URL' } });
    // The placeholder is treated as absent, so the baked value still applies.
    expect(cfg.apiBaseUrl).toBe(API);
    expect(normaliseBaseUrl('https://REPLACE-WITH-YOUR-WORKER-URL').url).toBeNull();
  });

  it('does not write a placeholder template when the installer already carries an origin', () => {
    const { userData, appRoot } = fixture({ baked: { api_base_url: API } });
    const cfg = loadConfig({ userData, appRoot, env: {} });
    expect(ensureConfigTemplate(cfg)).toBe(false);
    expect(fs.existsSync(path.join(userData, 'config.json'))).toBe(false);
  });

  it('normalises a trailing slash away and refuses non-http schemes', () => {
    expect(normaliseBaseUrl(`${API}/`).url).toBe(API);
    expect(normaliseBaseUrl('file:///etc/passwd').url).toBeNull();
    expect(normaliseBaseUrl('not a url').url).toBeNull();
  });
});
