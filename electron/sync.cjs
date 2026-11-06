/**
 * The background sync engine. Owns the order of operations, nothing else:
 *
 *   PUSH first, then PULL.      Local edits are useless until the server has judged them, and the
 *                               verdict changes the local row's version. Pulling first would drag
 *                               the server's copy over a row we are about to push, inventing a
 *                               conflict out of nothing.
 *   Rows, then commands.        A document refers to master data by id. If the product a new sale
 *                               line points at has not landed yet, the server rejects the sale for a
 *                               missing product; pushing the catalogue first makes that impossible.
 *   One sync at a time.         A mutex, because a 30s tick, a connectivity flip and a debounced
 *                               save can all fire inside the same second, and two overlapping pulls
 *                               would each advance the cursor past rows the other had not applied.
 *
 * Nothing here is allowed to throw out of `runOnce`: a shop must keep selling while the line is
 * down, so every failure becomes a status field, a log line and a backoff timer.
 */
'use strict';

const registry = require('./registry.cjs');

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const PULL_MAX_PAGES = 200;           // 200 pages x 500 rows is far past any real shop's delta
const MAX_TRIES = 12;                 // after this a poisoned op is set aside, not retried forever

function errText(e) {
  if (!e) return 'unknown';
  if (typeof e === 'string') return e;
  return `${e.name ?? 'Error'}: ${e.message ?? String(e)}`;
}

/** @param {{cfg:any, store:any, log:Function, getToken:Function, fetchImpl?:Function, emit?:Function, timers?:any}} o */
function createSyncEngine({ cfg, store, log, getToken, fetchImpl, emit, timers }) {
  const doFetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const T = timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  };
  const listeners = new Set();
  const on = emit ?? ((s) => { for (const l of listeners) try { l(s); } catch { /* a dead renderer never breaks a sync */ } });

  let running = null;              // the in-flight runOnce promise, or null
  let failures = 0;                // consecutive network/5xx failures, drives the backoff
  let nextAttemptAt = 0;           // do not retry before this epoch ms
  let lastSyncedAt = store.meta.get('last_synced_at');
  let lastError = null;
  let reachable = false;
  let saveTimer = null;
  let tick = null;

  // ------------------------------------------------------------------ status --
  function status() {
    const counts = store.outbox.counts();
    return {
      online: netOnline(),
      reachable,
      syncing: !!running,
      last_synced_at: lastSyncedAt,
      pending: counts.PENDING + counts.FAILED,
      conflict: counts.CONFLICT,
      conflicts: store.conflicts.openCount(),
      synced: counts.SYNCED,
      error: lastError,
      retry_in_ms: Math.max(0, nextAttemptAt - Date.now()),
      device_id: store.deviceId(),
      api_base_url: cfg.apiBaseUrl,
      config_error: cfg.apiBaseError ?? null,
      backoff: failures,
    };
  }
  function publish() { const s = status(); on(s); return s; }

  function netOnline() {
    try {
      const net = require('node:net');
      if (typeof net.isOnline === 'function') return net.isOnline();
    } catch { /* older Electron: fall through to the probe alone */ }
    return true;
  }

  // ------------------------------------------------------------------ request --
  async function call(path, { method = 'GET', body, token } = {}) {
    if (!cfg.apiBaseUrl) throw new Error(`api_base_url is not configured (${cfg.configError ?? 'no config file'})`);
    const ctrl = new AbortController();
    const timer = T.setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs);
    try {
      const res = await doFetch(cfg.apiBaseUrl + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      let json = null;
      const text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
      return { status: res.status, json };
    } finally {
      T.clearTimeout(timer);
    }
  }

  /**
   * Reachability, not connectivity. `net.isOnline()` answers "is there a route", which is true on a
   * captive-portal hotel wifi and on a Cloudflare worker returning 500 — so the tick also pings the
   * API's own health endpoint and only calls the line live when that answers.
   */
  async function probe() {
    if (!netOnline() || !cfg.apiBaseUrl) { reachable = false; return false; }
    const ctrl = new AbortController();
    const timer = T.setTimeout(() => ctrl.abort(), cfg.probeTimeoutMs);
    try {
      const res = await doFetch(`${cfg.apiBaseUrl}/api/v1/health`, { signal: ctrl.signal });
      reachable = res.ok;
    } catch { reachable = false; } finally { T.clearTimeout(timer); }
    return reachable;
  }

  // -------------------------------------------------------------------- PUSH --
  /**
   * An op the server answered FAILED stays FAILED, which means it is still "pending" next iteration.
   * Without a guard here, one malformed record would spin the loop forever. So each run sets the
   * poison aside (it is retried on the following tick) and stops retrying it after MAX_TRIES, leaving
   * it visible in the queue rather than silently dropping it or starving the rows behind it.
   */
  function takePending(kind, attempted, limit) {
    const batch = store.outbox.pending(kind, limit + attempted.size)
      .filter((op) => !attempted.has(op.op_id) && Number(op.tries) < MAX_TRIES)
      .slice(0, limit);
    for (const op of batch) attempted.add(op.op_id);
    return batch;
  }

  async function pushRows(token) {
    const sent = { accepted: 0, conflict: 0, failed: 0 };
    const attempted = new Set();
    for (;;) {
      const batch = takePending('row', attempted, cfg.rowPushBatch);
      if (!batch.length) return sent;
      // The verdict names the record (entity + id), not the op; queueRowOp coalesces edits to the
      // same record into one op, so (entity,row_id) identifies exactly one op in this batch.
      const byRecord = new Map(batch.map((op) => [`${op.entity}:${op.row_id}`, op]));
      const rows = batch.map((op) => ({
        op_id: op.op_id,
        entity: op.entity,
        id: op.row_id,
        data: safeJson(op.payload_json, {}),
        base_version: Number(op.base_version) || 0,
        deleted: Number(op.deleted) === 1 ? 1 : 0,
      }));
      const res = await call('/api/v1/sync/push', { method: 'POST', token, body: { device_id: store.deviceId(), rows } });
      if (res.status === 401) throw authRequired();
      if (res.status >= 500 || res.status === 429) throw retryable(`rows/push ${res.status}`);
      const data = res.json?.data;
      if (!data) throw retryable(`rows/push unexpected response ${res.status}`);

      for (const r of (data.accepted ?? [])) {
        const op = byRecord.get(`${r.entity}:${r.id}`);
        if (!op) continue;
        store.outbox.mark(op.op_id, 'SYNCED');
        applyAccepted(op, r);
        sent.accepted++;
      }
      for (const c of (data.conflicts ?? [])) {
        const op = byRecord.get(`${c.entity}:${c.id}`);
        if (!op) continue;
        store.outbox.mark(op.op_id, 'CONFLICT', { error: `${c.reason}: ${c.message ?? ''}`.slice(0, 300) });
        store.conflicts.add({ entity: c.entity, rowId: c.id, localData: safeJson(op.payload_json, {}),
          serverData: c.server ?? null, reason: c.reason ?? 'VERSION' });
        // Server wins: rewind this entity just under the winner's stamp so the next pull page
        // carries the authoritative row back over the local copy.
        if (c.server?.updated_at) { const def = registry.entityOf(c.entity); if (def) store.rewindCursor(def, c.server.updated_at); }
        sent.conflict++;
      }
      for (const f of (data.failed ?? [])) {
        const op = byRecord.get(`${f.entity}:${f.id}`);
        if (op) { store.outbox.mark(op.op_id, 'FAILED', { error: `${f.code}: ${f.message}`.slice(0, 300), bumpTries: true }); sent.failed++; }
      }
    }
  }

  /** The accepted verdict carries the server's new version; the local row must agree with it or the
   *  next edit would push against a stale base_version and conflict for no reason. */
  function applyAccepted(op, verdict) {
    const def = registry.rowEntity(op.entity);
    if (!def) return;
    try {
      store.db.prepare(`UPDATE ${def.table} SET version=?, updated_at=?, synced=1 WHERE ${def.pk}=?`)
        .run(verdict.version, verdict.updated_at, op.row_id);
    } catch (e) { log('could not stamp the accepted version', { entity: op.entity, id: op.row_id, error: errText(e) }); }
  }

  async function pushCommands(token) {
    const sent = { accepted: 0, conflict: 0, failed: 0 };
    const attempted = new Set();
    for (;;) {
      const batch = takePending('command', attempted, cfg.commandPushBatch);
      if (!batch.length) return sent;
      const operations = batch.map((op) => {
        const body = safeJson(op.payload_json, {});
        return { idempotency_key: op.op_id, type: body.type, payload: body.payload ?? {}, local_time: body.local_time ?? new Date().toISOString() };
      });
      const res = await call('/api/v1/sync/push', { method: 'POST', token, body: { device_id: store.deviceId(), operations } });
      if (res.status === 401) throw authRequired();
      if (res.status >= 500 || res.status === 429) throw retryable(`commands/push ${res.status}`);
      const results = res.json?.data?.results;
      if (!Array.isArray(results)) throw retryable(`commands/push unexpected response ${res.status}`);
      const byKey = new Map(results.map((r) => [r.idempotency_key, r]));
      for (const op of batch) {
        const r = byKey.get(op.op_id);
        if (!r) continue;                                    // unanswered: left pending, retried next tick
        if (r.status === 'SYNCED') {
          // The server's own document number arrives with the verdict; the rows the pull brings back
          // carry it too, so the queue entry only needs to stop being pending.
          store.outbox.mark(op.op_id, 'SYNCED', { error: null });
          sent.accepted++;
        } else if (r.status === 'CONFLICT') {
          store.outbox.mark(op.op_id, 'CONFLICT', { error: `${r.code}: ${r.message_ur ?? r.message ?? ''}`.slice(0, 300) });
          store.conflicts.add({ entity: op.entity, rowId: op.row_id, localData: safeJson(op.payload_json, {}),
            serverData: null, reason: r.code ?? 'CONFLICT' });
          sent.conflict++;
        } else {
          store.outbox.mark(op.op_id, 'FAILED', { error: `${r.code ?? 'FAILED'}: ${r.message ?? r.message_ur ?? ''}`.slice(0, 300), bumpTries: true });
          sent.failed++;
        }
      }
    }
  }

  // -------------------------------------------------------------------- PULL --
  /** Entities are grouped by their own cursor: `since` is one value per request, so a table that
   *  fell behind must not drag every other table back through the same window. */
  function groupByCursor(names) {
    const groups = new Map();
    for (const name of names) {
      const cursor = store.cursorFor(name);
      const list = groups.get(cursor) ?? [];
      list.push(name);
      groups.set(cursor, list);
    }
    return groups;
  }

  async function pull(token) {
    const names = registry.ALL_ENTITIES.filter((e) => e.tier !== 'command').map((e) => e.entity);
    const out = { entities: 0, pages: 0, truncated: false };
    for (;;) {
      if (out.pages >= PULL_MAX_PAGES) { out.truncated = true; break; }
      // Rebuilt on every pass: applying a page advances that entity's cursor, so the next request has
      // to ask with the new value. Only entities that still share a cursor can travel together,
      // because `since` is one value per request.
      const groups = groupByCursor(names);
      let more = false;
      for (const [cursor, group] of groups) {
        for (let i = 0; i < group.length; i += cfg.pullEntitiesPerRequest) {
          const chunk = group.slice(i, i + cfg.pullEntitiesPerRequest);
          const qs = new URLSearchParams({ entity: chunk.join(','), limit: String(cfg.pullLimit) });
          if (cursor) qs.set('since', cursor);
          const res = await call(`/api/v1/sync/pull?${qs}`, { token });
          if (res.status === 401) throw authRequired();
          if (res.status === 429 || res.status >= 500) throw retryable(`pull ${res.status}`);
          if (res.status === 403) { log('pull refused for a chunk — the session lacks the permission', { entities: chunk.length }); continue; }
          const entities = res.json?.data?.entities;
          if (!entities) { log('pull returned no entity map', { status: res.status }); continue; }
          const applied = store.applyPullPage(entities);
          out.pages++;
          out.entities += Object.keys(entities).length;
          if (applied?.rejected) log('a pull page was rejected — the rows stay queued for the next pass', applied.rejected);
          if (Object.values(entities).some((s) => s?.has_more)) more = true;
        }
      }
      if (!more) break;
    }
    if (out.truncated) log('pull hit the page ceiling — the next sync continues from these cursors', out);
    return out;
  }

  // ------------------------------------------------------------------- ORCHEST --
  class AuthRequired extends Error { constructor() { super('AUTH_REQUIRED'); this.code = 'AUTH_REQUIRED'; } }
  class Retryable extends Error { constructor(m) { super(m); this.code = 'RETRYABLE'; } }
  function authRequired() { return new AuthRequired(); }
  function retryable(m) { return new Retryable(m); }

  /**
   * @param {string} reason what asked for this sync — 'boot' | 'tick' | 'online' | 'save' | 'manual'
   */
  async function runOnce(reason = 'manual') {
    if (running) return running;                       // the mutex: never two at once
    running = attempt(reason).finally(() => { running = null; publish(); });
    return running;
  }

  async function attempt(reason) {
    if (!cfg.apiBaseUrl) { lastError = 'CONFIG_MISSING'; publish(); return { skipped: 'CONFIG_MISSING' }; }
    if (Date.now() < nextAttemptAt && reason !== 'manual') return { skipped: 'BACKOFF' };
    if (!netOnline()) { reachable = false; lastError = 'OFFLINE'; publish(); return { skipped: 'OFFLINE' }; }

    const alive = await probe();
    publish();
    if (!alive) { reachable = false; lastError = 'UNREACHABLE'; return { skipped: 'UNREACHABLE' }; }

    const token = await getToken();
    if (!token) { lastError = 'NO_SESSION'; return { skipped: 'NO_SESSION' }; }

    const out = { pushed_rows: { accepted: 0, conflict: 0, failed: 0 }, pushed_commands: { accepted: 0, conflict: 0, failed: 0 }, pulled: 0 };
    try {
      out.pushed_rows = await pushRows(token);        // rows before commands: documents point at them
      out.pushed_commands = await pushCommands(token);
      const p = await pull(token);
      out.pulled = p.pages;
      failures = 0;
      nextAttemptAt = 0;
      lastSyncedAt = new Date().toISOString();
      store.meta.set('last_synced_at', lastSyncedAt);
      lastError = null;
      log('sync ok', { reason, ...out });
    } catch (e) {
      if (e instanceof AuthRequired) {
        // Never lose the queue over an expired session: the operator keeps working, and the shell
        // is told to ask for a login before the next attempt.
        lastError = 'AUTH_REQUIRED';
        log('sync deferred — the stored session is no longer valid', { reason });
      } else if (e instanceof Retryable) {
        failures++;
        const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
        nextAttemptAt = Date.now() + wait;
        lastError = errText(e);
        log('sync failed, will back off', { reason, failures, wait_ms: wait, error: lastError });
      } else {
        failures++;
        nextAttemptAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
        lastError = errText(e);
        log('unexpected sync error — nothing was lost, the queue is intact', { reason, error: lastError });
      }
    } finally { publish(); }
    return out;
  }

  function start() {
    stop();
    tick = T.setInterval(() => { void runOnce('tick'); }, cfg.syncIntervalMs);
    return tick;
  }
  function stop() { if (tick) { T.clearInterval(tick); tick = null; } }

  /** A save debounce, so twenty keystrokes in one form do not become twenty pushes. */
  function noteWrite() {
    if (saveTimer) T.clearTimeout(saveTimer);
    saveTimer = T.setTimeout(() => { saveTimer = null; void runOnce('save'); }, cfg.saveDebounceMs);
  }

  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }

  return { status, publish, runOnce, start, stop, noteWrite, probe, subscribe,
    AuthRequired, Retryable, get failures() { return failures; }, get reachable() { return reachable; } };
}

function safeJson(text, fallback) {
  if (text && typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = { createSyncEngine, BACKOFF_BASE_MS, BACKOFF_MAX_MS, MAX_TRIES: 12 };
