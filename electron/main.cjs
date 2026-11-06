/**
 * Zeeshan Traders — the desktop shell.
 *
 * What this file is responsible for, and nothing more:
 *   · one window, locked down (contextIsolation on, nodeIntegration off, sandbox on, no remote
 *     navigation, no requests anywhere except the shop's own API);
 *   · the local database and the sync engine, both of which outlive any renderer reload;
 *   · the session vault, which is the only place a token is ever written;
 *   · the IPC surface the preload publishes. That surface is the whole contract — the renderer has no
 *     node, no fs, no sqlite and no token, and cannot reach anything else.
 *
 * The app opens on the ERP, always. A shop counter is not a marketing site: there is no storefront
 * route to land on, and the public catalogue is not loaded, parsed or shipped in this build.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, safeStorage, net, protocol, session: electronSession } = require('electron');

const { loadConfig, ensureConfigTemplate } = require('./config.cjs');
const { createLogger } = require('./logger.cjs');
const { openLocalDb } = require('./db.cjs');
const { createSyncEngine } = require('./sync.cjs');
const { createRestServe } = require('./rest-serve.cjs');
const { createVault } = require('./vault.cjs');
const bundle = require('./bundle.cjs');

const QUIT_FLUSH_MS = 6_000;          // best-effort final push; never hold the shop's machine open

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Two installs writing one SQLite file is corruption, not a feature. The second launch wakes the first.
  app.quit();
} else {
  boot();
}

function boot() {
  const cfg = loadConfig({ userData: app.getPath('userData'), env: process.env });
  ensureConfigTemplate(cfg);
  const logger = createLogger({ dir: cfg.logDir, echo: cfg.verboseLog });
  const log = (message, extra) => logger.log(message, extra);
  let win = null;
  let store = null;
  let engine = null;
  let rest = null;
  let vault = null;
  let quitting = false;
  let bundleSchemeOk = false;

  // Before `ready`, and only once: the bundle is served from a private scheme so its ES modules and
  // its `/assets`, `/brand` URLs have a real origin. `file://` gives them an opaque one instead, which
  // is a blank window with a CORS error in the console.
  try {
    protocol.registerSchemesAsPrivileged([{
      scheme: bundle.SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    }]);
    bundleSchemeOk = true;
  } catch (e) {
    logger.error('could not register the bundle scheme — falling back to file://', { error: String(e?.message ?? e) });
  }

  process.on('unhandledRejection', (e) => logger.error('unhandled rejection', e));
  process.on('uncaughtException', (e) => {
    // A crash is the one outcome that loses work, so nothing here is allowed to take the process down.
    logger.error('uncaught exception in main', { error: String(e?.stack ?? e) });
    if (store) { try { store.close(); } catch { /* already gone */ } }
    app.exit(1);
  });

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  // ------------------------------------------------------------------ session --
  function initVault() {
    return createVault({
      file: cfg.sessionFile,
      log,
      cipher: {
        available: safeStorage.isEncryptionAvailable(),
        encryptString: (s) => safeStorage.encryptString(typeof s === 'string' ? s : s.toString('utf8')),
        decryptString: (b) => safeStorage.decryptString(b),
      },
    });
  }

  /** Set-Cookie harvesting: the desktop has no cookie jar, so the token is lifted out of the login
   *  response and replayed as `Authorization: Bearer`. Nothing ever reaches the renderer. */
  function harvestCookies(res) {
    const cookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : String(res.headers.get('set-cookie') ?? '').split(/,(?=[^\s;]+=)/);
    const pick = (name) => {
      for (const c of cookies) {
        const m = new RegExp(`${name}=([^;]+)`).exec(c);
        if (m) return m[1];
      }
      return null;
    };
    const token = pick('zt_session');
    if (!token) return null;
    return { token, csrf: pick('zt_csrf'), expires_at: pick('zt_expires') };
  }

  async function forward(method, url, body) {
    if (!cfg.apiBaseUrl) return null;
    const token = vault.token();
    let res;
    try {
      res = await fetch(cfg.apiBaseUrl + url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-desktop': '1',
        },
        body: body === undefined ? undefined : JSON.stringify(body ?? {}),
      });
    } catch (e) {
      logger.warn('forward failed', { method, path: url.split('?')[0], error: String(e?.message ?? e) });
      return null;                                   // the caller answers 503 OFFLINE_UNAVAILABLE
    }
    const fresh = harvestCookies(res);
    if (fresh) {
      const current = vault.session() ?? {};
      vault.save({ ...current, ...fresh, user: fresh.token === current.token ? current.user : null });
      logger.info('session refreshed from the API');
    }
    if (method === 'POST' && /\/auth\/logout/.test(url)) vault.clear();

    const status = res.status;
    const ctype = String(res.headers.get('content-type') ?? '');
    const settled = status >= 200 && status < 300;

    // An export answers with CSV text and a backup with opaque bytes; under file:// the renderer can
    // only save what the main process hands back, so those become a string or a base64 payload rather
    // than a JSON parse that would have thrown and returned nothing.
    if (!/json/i.test(ctype)) {
      if (/^text\//i.test(ctype) || /csv/i.test(ctype)) {
        return { ok: settled, status, data: await res.text().catch(() => '') };
      }
      const buf = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
      return { ok: settled, status, data: { base64: buf.toString('base64') } };
    }

    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
    if (json === undefined) return { ok: settled, status, data: text };
    if (json && typeof json === 'object' && 'ok' in json) {
      // The last good /auth/me is the offline session. Caching it here (as well as in
      // revalidateSession) means a launch that happens to be offline still knows who is signed in
      // from the vault — otherwise the renderer would fall back to the login screen on every
      // restart without a network, which is exactly the offline-first case this build exists for.
      if (json.ok && method === 'GET' && /\/auth\/me(?:\?|$)/.test(url)) {
        const current = vault.session();
        if (current) vault.save({ ...current, user: json.data, expired: false });
      }
      return json.ok
        ? { ok: true, status, data: json.data }
        : { ok: false, status, error: json.error ?? { code: 'ERROR', message_ur: '', message_en: '' } };
    }
    return { ok: settled, status, data: json };
  }

  // ------------------------------------------------------------------- boot db --
  function openStore() {
    try {
      return openLocalDb({ file: cfg.dbFile, appRoot: cfg.appRoot, log: (m, e) => logger.warn(m, e) });
    } catch (e) {
      // The usual cause is a native module built for another Electron version — `npm run dist:win`
      // rebuilds it, so say which command to run rather than showing a stack trace to a shop.
      logger.error('could not open the local database', { file: cfg.dbFile, error: String(e?.message ?? e) });
      throw e;
    }
  }

  // --------------------------------------------------------------------- window --
  function allowedNavigation(urlString) {
    let u;
    try { u = new URL(urlString); } catch { return false; }
    if (u.protocol === `${bundle.SCHEME}:` && u.host === bundle.HOST) return true;
    if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return true;
    if (cfg.devServerUrl && u.origin === new URL(cfg.devServerUrl).origin) return true;
    if (cfg.apiBaseUrl && u.origin === new URL(cfg.apiBaseUrl).origin) return true;
    return false;
  }

  /** `zt-app://bundle/…` → a file under <root>/out. Registered after `ready`, as Electron requires. */
  function serveBundle(root) {
    protocol.handle(bundle.SCHEME, (request) => {
      const url = new URL(request.url);
      const out = bundle.readBundleFile(root, url.pathname);
      return new Response(out.body, {
        status: out.status,
        headers: { 'content-type': out.content_type, 'cache-control': 'no-cache' },
      });
    });
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      show: false,
      backgroundColor: '#0d1117',
      title: cfg.productName ?? 'Zeeshan Traders',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--zt-version=${app.getVersion()}`],
        spellcheck: false,
        devTools: process.env.NODE_ENV !== 'production' || cfg.verboseLog,
      },
    });
    win.once('ready-to-show', () => win.show());

    win.webContents.on('will-navigate', (event, url) => {
      if (!allowedNavigation(url)) { event.preventDefault(); logger.warn('blocked navigation', { url }); }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      logger.warn('blocked window.open', { url });
      return { action: 'deny' };
    });
    win.on('closed', () => { win = null; });

    if (cfg.devServerUrl) void win.loadURL(cfg.devServerUrl);
    else {
      const root = path.join(cfg.appRoot, 'out');
      if (!fs.existsSync(path.join(root, 'index.html'))) {
        logger.error('the desktop bundle is missing — run `npm run build:desktop`', { root });
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
          '<meta charset="utf-8"><body style="font:16px system-ui;padding:3rem;max-width:40rem;margin:auto">' +
          '<h1>Desktop bundle not found</h1><p>Run <code>npm run build:desktop</code> and start the app again. ' +
          'This window shows only the ERP; it never loads the website.</p></body>'));
        return;
      }
      // #/erp is the entry point: the storefront route does not exist in this build at all.
      if (bundleSchemeOk) { void win.loadURL(bundle.entryUrl()); return; }
      logger.warn('falling back to file:// — Chromium may refuse the bundle ES modules', { root });
      void win.loadFile(path.join(root, 'index.html'), { hash: '/erp' });
    }
  }

  // ------------------------------------------------------------------ IPC surface --
  function broadcast(status) {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('zt:status', status);
    }
  }

  function registerIpc() {
    ipcMain.handle('zt:request', async (_e, { method = 'GET', path: p = '/', body } = {}) => {
      try {
        const out = await rest.handle(String(method).toUpperCase(), String(p), body);
        if (out?.ok && method !== 'GET') engine.noteWrite();     // debounce: twenty keystrokes, one push
        return out;
      } catch (e) {
        logger.error('ipc request failed', { method, path: p, error: String(e?.message ?? e) });
        return { ok: false, status: 500, error: { code: 'DESKTOP_INTERNAL',
          message_ur: 'ڈیسک ٹاپ میں اندرونی خرابی', message_en: String(e?.message ?? e) } };
      }
    });

    ipcMain.handle('zt:status', () => engine.status());

    ipcMain.handle('zt:sync-now', async () => { await engine.runOnce('manual'); return engine.status(); });

    ipcMain.handle('zt:conflicts', (_e, { limit = 200 } = {}) => store.conflicts.list({ limit }).map((c) => ({
      ...c,
      // The screen reads `local_data`/`server_data` as values, not as JSON text — and `local`/`server`
      // are what the store already parsed, so nothing here re-reads the file.
      local_data: c.local, server_data: c.server,
    })));

    ipcMain.handle('zt:resolve-conflict', async (_e, { id, choice } = {}) => {
      const out = store.conflicts.resolve(String(id), String(choice));
      if (out?.ok) void engine.runOnce('resolve');
      return out;
    });

    /** The queue screen reads the same field names the browser's Dexie outbox used, so the two queue
     *  views are one view. `id` is the op id, which doubles as the server's idempotency key. */
    ipcMain.handle('zt:outbox', (_e, { state = null, limit = 200 } = {}) => store.outbox.list({ state, limit })
      .map((op) => ({
        ...op,
        id: op.op_id,
        status: op.state,
        type: op.kind === 'command' ? (op.payload?.type ?? op.entity) : op.entity,
        local_time: op.payload?.local_time ?? null,
        server_number: null,
      })));

    ipcMain.handle('zt:entity-list', (_e, { entity, opts = {} } = {}) => {
      try { return store.list(String(entity), opts); }
      catch (e) { return { rows: [], total: 0, error: String(e?.message ?? e) }; }
    });

    ipcMain.handle('zt:entity-get', (_e, { entity, id } = {}) => {
      try { return store.get(String(entity), String(id)); } catch { return null; }
    });

    ipcMain.handle('zt:session', () => {
      const s = vault.session();
      const online = !!cfg.apiBaseUrl && net.isOnline() !== false && engine.reachable;
      // An expired token is not a signed-out shop: offline, the local mirror keeps working.
      return { authenticated: !!s && (!s.expired || !online), user: s?.user ?? null, expires_at: s?.expires_at ?? null };
    });

    ipcMain.handle('zt:online', () => net.isOnline() !== false);

    // The renderer knows about `online`/`offline` events before the main process does.
    ipcMain.on('zt:net', (_e, online) => { if (online) void engine.runOnce('online'); });

    ipcMain.handle('zt:app-info', () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: `${process.platform}/${process.arch}`,
      db_file: cfg.dbFile,
      log_file: logger.file,
      session_encrypted: vault.encryptionAvailable(),
      api_base_url: cfg.apiBaseUrl,
      config_file: cfg.configFile,
      config_error: cfg.configError,
      schema: store.boot?.schema?.failures?.length ? `${store.boot.schema.failures.length} statements failed` : 'complete',
    }));
  }

  // ------------------------------------------------------------------- startup --
  app.on('ready', async () => {
    if (!cfg.apiBaseUrl) logger.warn('no api_base_url — the app will run fully offline until it is set',
      { file: cfg.configFile });

    store = openStore();
    vault = initVault();

    engine = createSyncEngine({
      cfg,
      store,
      log: (m, e) => logger.log(m, e),
      getToken: async () => vault.token(),
      emit: (s) => setImmediate(() => broadcast(s)),
    });

    rest = createRestServe({
      store,
      log: (m, e) => logger.log(m, e),
      http: {
        forward,
        reachable: () => !!cfg.apiBaseUrl && net.isOnline() !== false,
      },
    });

    registerIpc();
    hardenSession();
    if (bundleSchemeOk) serveBundle(path.join(cfg.appRoot, 'out'));
    createWindow();
    engine.start();
    void engine.runOnce('boot').then(() => revalidateSession());
  });

  /**
   * A stored token is only worth trusting after the server has seen it. One call at startup settles
   * whether the ERP is open for business or the login screen is: 401 means the session died while the
   * machine slept, and the shop is asked to sign in — with the queue and the mirror left untouched.
   */
  async function revalidateSession() {
    if (!vault.token() || !cfg.apiBaseUrl || net.isOnline() === false) return;
    const out = await forward('GET', '/api/v1/auth/me', undefined);
    if (out?.ok) {
      const s = vault.session() ?? {};
      vault.save({ ...s, user: out.data, expired: false });
      logger.info('session revalidated', { user: out.data?.user?.username ?? null });
    } else if (out?.status === 401 || out?.status === 403) {
      logger.warn('stored session no longer accepted — the ERP will ask for a login');
      vault.save({ ...(vault.session() ?? {}), expired: true });
    }
    broadcast(engine.status());
  }

  function hardenSession() {
    const ses = electronSession.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      // The ERP needs no camera, microphone, geolocation or notifications. Deny by default.
      callback(new Set(['fullscreen']).has(permission));
    });
    ses.on('will-download', (_e, item) => {
      logger.info('download started', { file: item.getFilename() });
    });
    // Nothing the renderer asks for may leave for a third-party host. The API is the only network
    // destination in this build, which is how "no external requests at runtime" is enforced rather
    // than merely intended — a CDN font, an analytics beacon or a stray <img> cannot sneak through.
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const remote = /^https?:/.test(details.url);
      const wanted = remote && (
        (cfg.apiBaseUrl && details.url.startsWith(cfg.apiBaseUrl)) ||
        (cfg.devServerUrl && details.url.startsWith(cfg.devServerUrl)));
      callback({ cancel: remote && !wanted });
    });
  }

  app.on('window-all-closed', () => { app.quit(); });

  app.on('before-quit', (event) => {
    if (quitting) return;
    engine?.stop();
    const pending = store?.pendingCount() ?? 0;
    if (pending && net.isOnline() !== false && cfg.apiBaseUrl) {
      // Give the last invoice of the day a chance to leave the queue, then stop waiting.
      event.preventDefault();
      quitting = true;
      logger.info('flushing the queue before quitting', { pending });
      const flush = Promise.race([
        engine.runOnce('quit'),
        new Promise((r) => setTimeout(r, QUIT_FLUSH_MS)),
      ]).catch((e) => logger.error('quit flush failed', { error: String(e?.message ?? e) }));
      void flush.finally(() => { store.close(); app.exit(0); });
      return;
    }
    store?.close();
  });
}
