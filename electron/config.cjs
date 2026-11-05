/**
 * Runtime configuration for the desktop shell — no hardcoded URLs anywhere.
 *
 * Precedence: process.env.DESKTOP_API_URL  >  <userData>/config.json { "api_base_url": … }
 * The shop's owner sets the URL once in config.json; nothing in this repo knows where the API lives.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  sync_interval_ms: 30_000,
  save_debounce_ms: 4_000,
  probe_timeout_ms: 5_000,
  request_timeout_ms: 20_000,
  row_push_batch: 150,       // the server's own limit is 200
  command_push_batch: 40,    // the server's own limit is 50
  pull_limit: 500,
  pull_entities_per_request: 10,
  log: false,
};

function readConfigFile(userData) {
  const file = path.join(userData, 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, raw, error: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { file, raw: null, error: null };
    return { file, raw: null, error: `${file}: ${e.message}` };
  }
}

/** Absolute, no trailing slash, http(s) only. Everything else is a configuration error, not a guess. */
function normaliseBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return { url: null, error: 'api_base_url is not set' };
  let u;
  try { u = new URL(value.trim()); } catch { return { url: null, error: `api_base_url is not a valid URL: ${value}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { url: null, error: `api_base_url must be http(s): ${value}` };
  }
  return { url: u.origin + (u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : ''), error: null };
}

/**
 * @param {{userData: string, env?: NodeJS.ProcessEnv, appRoot?: string}} opts
 */
function loadConfig({ userData, env = process.env, appRoot = path.resolve(__dirname, '..') }) {
  const { file, raw, error: parseError } = readConfigFile(userData);
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };

  const candidate = env.DESKTOP_API_URL || cfg.api_base_url || '';
  const base = normaliseBaseUrl(candidate);

  return {
    appRoot,
    userData,
    configFile: file,
    configError: parseError,
    apiBaseUrl: base.url,
    apiBaseError: base.error,
    productName: env.ZT_PRODUCT_NAME || cfg.product_name || null,
    dbFile: env.ZT_DB_PATH || path.join(userData, 'zeeshan-traders.db'),
    logDir: path.join(userData, 'logs'),
    sessionFile: path.join(userData, 'session.bin'),
    devServerUrl: env.ELECTRON_START_URL || null,
    syncIntervalMs: int(cfg.sync_interval_ms, DEFAULTS.sync_interval_ms),
    saveDebounceMs: int(cfg.save_debounce_ms, DEFAULTS.save_debounce_ms),
    probeTimeoutMs: int(cfg.probe_timeout_ms, DEFAULTS.probe_timeout_ms),
    requestTimeoutMs: int(cfg.request_timeout_ms, DEFAULTS.request_timeout_ms),
    rowPushBatch: int(cfg.row_push_batch, DEFAULTS.row_push_batch),
    commandPushBatch: int(cfg.command_push_batch, DEFAULTS.command_push_batch),
    pullLimit: int(cfg.pull_limit, DEFAULTS.pull_limit),
    pullEntitiesPerRequest: int(cfg.pull_entities_per_request, DEFAULTS.pull_entities_per_request),
    verboseLog: cfg.log === true || env.ZT_DEBUG === '1',
  };
}

const int = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : fallback);

/** Written once so a misconfigured install tells the shop exactly which file to edit. */
function ensureConfigTemplate(cfg) {
  if (cfg.apiBaseUrl || cfg.configError) return false;
  if (fs.existsSync(cfg.configFile)) return false;
  try {
    fs.writeFileSync(cfg.configFile, `${JSON.stringify({
      api_base_url: 'https://REPLACE-WITH-YOUR-WORKER-URL',
      sync_interval_ms: DEFAULTS.sync_interval_ms,
    }, null, 2)}\n`, 'utf8');
    return true;
  } catch { return false; }
}

module.exports = { loadConfig, ensureConfigTemplate, normaliseBaseUrl, DEFAULTS };
