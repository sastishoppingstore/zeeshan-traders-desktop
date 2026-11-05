/**
 * Small append-only file logger with daily rotation. Main-process only.
 *
 * Offline sync is the kind of bug you find days later by reading what actually happened at 07:12 in
 * the shop, so the log has to survive restarts and stay small enough to email in. Rotation is by
 * filename date, and anything that looks like a credential is masked before it is written.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KEEP_DAYS = 14;
const SECRET_KEY_RE = /(token|password|secret|authorization|cookie|session|cnic|pin)/i;
const SECRET_VALUE_RE = /\b(Bearer\s+)[A-Za-z0-9._\-]{8,}|\b[0-9a-f]{32,}\b/gi;

const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);

/** Turn a value into a short, single-line, credential-free string. */
function brief(value, depth = 0) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const one = value.replace(/\s+/g, ' ').trim();
    return one.length > 300 ? `${one.slice(0, 300)}…` : one;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value instanceof Date) return String(value);
  if (depth > 2) return '[…]';
  try {
    const entries = Object.entries(value).slice(0, 12).map(([k, v]) => {
      if (SECRET_KEY_RE.test(k)) return `${k}=[masked]`;
      if (v instanceof Error) return `${k}=${v.message}`;
      return `${k}=${brief(v, depth + 1)}`;
    });
    return `{${entries.join(' ')}}`;
  } catch {
    return '[unserialisable]';
  }
}

function mask(text) {
  return String(text).replace(SECRET_VALUE_RE, (m, bearer) => (bearer ? `${bearer}[masked]` : '[masked]'));
}

/**
 * @param {{dir: string, name?: string, echo?: boolean}} opts  dir = the folder that holds the logs
 */
function createLogger({ dir, name = 'sync', echo = true }) {
  let currentDay = null;
  let file = null;

  const openFor = (day) => {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${name}-${day}.log`);
    currentDay = day;
    prune();
    return file;
  };

  /** Delete rotated files older than KEEP_DAYS so a shop PC never fills its disk with logs. */
  function prune() {
    try {
      const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith(`${name}-`) || !f.endsWith('.log')) continue;
        const full = path.join(dir, f);
        const inName = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(f.slice(name.length + 1));
        const old = inName ? Date.parse(inName[1]) < cutoff : fs.statSync(full).mtimeMs < cutoff;
        if (old) fs.rmSync(full, { force: true });
      }
    } catch { /* rotation is best-effort; never let logging take the app down */ }
  }

  function write(level, args) {
    const at = new Date();
    const day = dayOf(at);
    if (day !== currentDay || !file) openFor(day);
    const line = `${at.toISOString()} ${level.padEnd(5)} ${mask(args.map((a) => brief(a)).join(' '))}\n`;
    try { fs.appendFileSync(file, line); } catch { /* disk full / locked: logging must not throw */ }
    if (echo) {
      const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
      out(`[zt:${level.toLowerCase()}]`, ...args);
    }
  }

  return {
    get file() { return file ?? openFor(dayOf()); },
    get day() { return currentDay ?? dayOf(); },
    debug: (...a) => write('DEBUG', a),
    info: (...a) => write('INFO', a),
    warn: (...a) => write('WARN', a),
    error: (...a) => write('ERROR', a),
    /** Generic entry, used by the sync engine for phase events. */
    log: (msg, extra) => write('INFO', extra === undefined ? [msg] : [msg, extra]),
    prune,
  };
}

module.exports = { createLogger, brief, mask, KEEP_DAYS };
