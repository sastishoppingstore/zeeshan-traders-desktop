/**
 * SQL statement splitting and Cloudflare/D1 filtering, with no dependencies so it can be unit
 * tested with plain Node (`node electron/verify-migrations.cjs`).
 *
 * The desktop mirrors the server schema by replaying the repo's own migrations/*.sql. That is only
 * correct if the replay is statement-exact: a hand-copied schema drifts the moment somebody adds a
 * column, and the desktop then silently drops a field the web clients can edit. So we read the real
 * files and remove exactly two classes of statement — nothing else.
 */
'use strict';

/** Statements that exist only inside a D1 database and must never be replayed locally. */
const CLOUDFLARE_INTERNAL_TABLES = [
  '_cf_KV',            // D1's internal KV namespace; only writable by workerd (SELECT on it gives SQLITE_AUTH)
  '_cf_SqliteMaster',
  'd1_migrations',     // wrangler's own migration journal — the desktop keeps its own (schema_version)
  'DDL_STATEMENTS',    // generated artifacts, not part of the app schema
];

const INTERNAL_RE = new RegExp(
  `\\b(${CLOUDFLARE_INTERNAL_TABLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi');

/** Statement kinds the desktop must own instead of inheriting from the server's setup. */
const LOCAL_ONLY_HEADS = ['PRAGMA'];   // journal mode / foreign_keys are per-connection, set in db.cjs

const BREAKPOINT_RE = /^\s*>+\s*statement-breakpoint\b/i;

/**
 * Split SQL into executable statements. Quote- and comment-aware, because this schema stores Urdu
 * literals inside INSERT statements (`'کھاد'`) and a naive `split(';')` corrupts them.
 * Drizzle-style `--> statement-breakpoint` markers also end a statement, so a file that relies on
 * them instead of semicolons still splits correctly.
 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  let mode = 'code'; // code | squote | dquote | backquote | line-comment | block-comment

  const flush = () => {
    const text = buf.trim();
    buf = '';
    if (text) out.push({ sql: text, line: startLine });
    startLine = line;
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '\n') line++;

    if (mode === 'line-comment') { if (ch === '\n') mode = 'code'; continue; }
    if (mode === 'block-comment') {
      if (ch === '*' && next === '/') { mode = 'code'; i++; }
      continue;
    }
    if (mode === 'squote') {
      buf += ch;
      if (ch === "'" && next === "'") { buf += next; i++; continue; }  // '' escape inside a literal
      if (ch === "'") mode = 'code';
      continue;
    }
    if (mode === 'dquote' || mode === 'backquote') {
      buf += ch;
      if (ch === (mode === 'dquote' ? '"' : '`')) mode = 'code';
      continue;
    }

    // --- code mode ---
    if (ch === '-' && next === '-') {
      // A `--> statement-breakpoint` marker separates statements; an ordinary `--` comment does not.
      if (BREAKPOINT_RE.test(sql.slice(i + 2, i + 40))) {
        flush();
        const eol = sql.indexOf('\n', i);
        i = eol === -1 ? sql.length : eol - 1;   // the \n is consumed by the loop's next pass
        continue;
      }
      mode = 'line-comment';
      i++;
      continue;
    }
    if (ch === '/' && next === '*') { mode = 'block-comment'; i++; continue; }

    if (!buf.length && ch.trim()) startLine = line;
    buf += ch;
    if (ch === "'" ) { mode = 'squote'; continue; }
    if (ch === '"') { mode = 'dquote'; continue; }
    if (ch === '`') { mode = 'backquote'; continue; }
    if (ch === ';') { flush(); continue; }
  }
  flush();
  return out;
}

/** First meaningful words of a statement, for classification (`CREATE TABLE`, `ALTER TABLE`). */
function headOf(sql) {
  const m = /^\s*(\w+)(?:\s+(?:OR\s+\w+\s+)?(\w+))?/i.exec(sql);
  return m ? `${m[1]} ${m[2] || ''}`.trim().toUpperCase() : '';
}

/**
 * Decide what to do with one statement.
 * Returns { action: 'run'|'skip', reason } — `skip` is only ever chosen for Cloudflare internals
 * and per-connection PRAGMAs, never for real DDL, so a schema change can never be lost silently.
 */
function classifyStatement(sql) {
  // The first word alone, not `headOf`'s two-word head: `PRAGMA foreign_keys = ON` heads as
  // "PRAGMA FOREIGN_KEYS", which would never equal the "PRAGMA" prefix and would replay a
  // per-connection setting over the one db.cjs just chose.
  const firstWord = /^\s*(\w+)/.exec(headOf(sql))?.[1] ?? '';
  for (const prefix of LOCAL_ONLY_HEADS) {
    if (firstWord === prefix) return { action: 'skip', reason: 'pragma-is-per-connection' };
  }
  if (findInternalReferences(sql).length) return { action: 'skip', reason: 'cloudflare-internal' };
  return { action: 'run', reason: '' };
}

/** Table names from the Cloudflare-internal list that appear anywhere in this SQL. */
function findInternalReferences(sql) {
  const hits = [];
  INTERNAL_RE.lastIndex = 0;
  let m;
  while ((m = INTERNAL_RE.exec(sql)) !== null) hits.push(m[1]);
  return [...new Set(hits)];
}

/** Turn a whole migration file into the ordered list of statements to actually execute. */
function planMigration(sql) {
  const run = [];
  const skipped = [];
  for (const st of splitStatements(sql)) {
    const verdict = classifyStatement(st.sql);
    if (verdict.action === 'run') run.push(st);
    else skipped.push({ line: st.line, reason: verdict.reason, sql: st.sql.slice(0, 120) });
  }
  return { run, skipped };
}

module.exports = {
  CLOUDFLARE_INTERNAL_TABLES,
  LOCAL_ONLY_HEADS,
  splitStatements,
  classifyStatement,
  findInternalReferences,
  planMigration,
  headOf,
};
