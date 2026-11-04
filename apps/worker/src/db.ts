/**
 * D1-compatible database abstraction.
 * - Cloudflare: wraps a real D1Database; db.batch() is ONE implicit transaction (spec 0.1b).
 * - Local preview/tests: node:sqlite DatabaseSync with BEGIN/COMMIT around the same batch.
 * Repositories never see the difference. ALL SQL is parameterised (never string-interpolated user input).
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
export { DatabaseSync } from 'node:sqlite';

export type BindArg = any; // normalised by v()/norm() below; never interpolated into SQL text

export interface QueryResult { changes: number; last_row_id?: number | bigint }

export interface Q {
  readonly sql: string;
  args: BindArg[];
  bind(...args: BindArg[]): Q;
  all<T = Record<string, unknown>>(...args: BindArg[]): Promise<T[]>;
  first<T = Record<string, unknown>>(...args: BindArg[]): Promise<T | null>;
  run(...args: BindArg[]): Promise<QueryResult>;
  /** D1 prepared statement, only present in the Cloudflare adapter. */
  raw?: unknown;
}

export interface DB {
  prepare(sql: string): Q;
  batch(statements: Q[]): Promise<QueryResult[]>;
  exec(sql: string): Promise<void>;
  stats: { reads: number; writes: number };
}

/** Minimal structural types so Worker code type-checks without @cloudflare/workers-types installed. */
export interface D1PreparedStatementLike {
  bind(...args: any[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<{ results?: T[]; success?: boolean; meta?: Record<string, any> }>;
  first<T = unknown>(column?: string): Promise<T | null>;
  run(): Promise<{ success?: boolean; meta?: Record<string, any> }>;
}
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<{ results?: T[]; success?: boolean; meta?: Record<string, any> }[]>;
  exec(sql: string): Promise<{ count?: number; duration?: number }>;
}
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number } | null>;
  list(options?: { prefix?: string }): Promise<{ objects: { key: string; size: number }[] }>;
}

class D1Query implements Q {
  private stmt: D1PreparedStatementLike;
  raw: D1PreparedStatementLike;
  constructor(public readonly sql: string, public args: BindArg[], private db: D1DB) {
    this.stmt = db.binding.prepare(sql);
    this.raw = this.stmt;
  }
  bind(...args: BindArg[]): Q {
    this.args = args;
    this.stmt = this.db.binding.prepare(this.sql).bind(...args);
    this.raw = this.stmt;
    return this;
  }
  private bound(extra: BindArg[]): void {
    if (extra.length) this.bind(...extra);
  }
  async all<T>(...extra: BindArg[]): Promise<T[]> {
    this.bound(extra);
    const r = await this.stmt.all<T>();
    const rows = (r.results ?? []) as T[];
    this.db.stats.reads += rows.length;
    return rows;
  }
  async first<T>(...extra: BindArg[]): Promise<T | null> {
    this.bound(extra);
    const r = await this.stmt.first<T>();
    if (r) this.db.stats.reads += 1;
    return r ?? null;
  }
  async run(...extra: BindArg[]): Promise<QueryResult> {
    this.bound(extra);
    const r = await this.stmt.run();
    const meta = (r.meta ?? {}) as Record<string, number>;
    const changes = Number(meta.changes ?? meta.rows_written ?? 1);
    this.db.stats.writes += Math.max(1, changes);
    return { changes, last_row_id: meta.last_row_id };
  }
}

export class D1DB implements DB {
  stats = { reads: 0, writes: 0 };
  constructor(public binding: D1DatabaseLike) {}
  prepare(sql: string): Q { return new D1Query(sql, [], this); }
  async batch(statements: Q[]): Promise<QueryResult[]> {
    const raws = statements.map((s) => (s.raw ?? s) as D1PreparedStatementLike);
    const results = await this.binding.batch<any>(raws);
    return results.map((r) => {
      const meta = (r.meta ?? {}) as Record<string, number>;
      const rows = (r.results as any[] | undefined)?.length ?? 0;
      this.stats.reads += rows;
      const changes = Number(meta.changes ?? meta.rows_written ?? 1);
      this.stats.writes += changes;
      return { changes, last_row_id: meta.last_row_id };
    });
  }
  async exec(sql: string): Promise<void> { await this.binding.exec(sql); }
}

class LocalQuery implements Q {
  constructor(public readonly sql: string, public args: BindArg[], private db: LocalDB) {}
  bind(...args: BindArg[]): Q { this.args = args; return this; }
  private norm(args: BindArg[]): BindArg[] {
    const src = args.length ? args : this.args;
    return src.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
  }
  async all<T>(...extra: BindArg[]): Promise<T[]> {
    const rows = this.db.binding.prepare(this.sql).all(...this.norm(extra)) as T[];
    this.db.stats.reads += rows.length;
    return rows;
  }
  async first<T>(...extra: BindArg[]): Promise<T | null> {
    const row = (this.db.binding.prepare(this.sql).get(...this.norm(extra)) ?? null) as T | null;
    if (row) this.db.stats.reads += 1;
    return row ?? null;
  }
  async run(...extra: BindArg[]): Promise<QueryResult> {
    const r = this.db.binding.prepare(this.sql).run(...this.norm(extra));
    this.db.stats.writes += Math.max(1, Number(r.changes));
    return { changes: Number(r.changes), last_row_id: r.lastInsertRowid };
  }
}

export class LocalDB implements DB {
  stats = { reads: 0, writes: 0 };
  private depth = 0;
  constructor(public binding: DatabaseSync) {}
  prepare(sql: string): Q { return new LocalQuery(sql, [], this); }
  async batch(statements: Q[]): Promise<QueryResult[]> {
    if (this.depth > 0) throw new Error('nested db.batch() is not supported');
    this.depth++;
    this.binding.exec('BEGIN IMMEDIATE');
    try {
      const out: QueryResult[] = [];
      for (const s of statements) {
        const stmt = this.binding.prepare(s.sql);
        const args = s.args.map((a) => (typeof a === 'boolean' ? (a ? 1 : 0) : a === undefined ? null : a));
        const isRead = /^\s*(SELECT|PRAGMA|EXPLAIN)/i.test(s.sql);
        if (isRead) {
          const rows = stmt.all(...args);
          this.stats.reads += rows.length;
          out.push({ changes: 0 });
        } else {
          const r = stmt.run(...args);
          this.stats.writes += Math.max(1, Number(r.changes));
          out.push({ changes: Number(r.changes), last_row_id: r.lastInsertRowid });
        }
      }
      this.binding.exec('COMMIT');
      return out;
    } catch (e) {
      this.binding.exec('ROLLBACK');
      if ((globalThis as any).process?.env?.ZT_DEBUG_SQL) {
        // Last executed statement is the most likely culprit; print all for diagnosis.
        console.error('[ZT DEBUG SQL]', String(e), '\n' + statements.map((s, i) => `${i}: ${s.sql.slice(0, 220)} :: ${JSON.stringify(s.args).slice(0, 200)}`).join('\n'));
      }
      throw e;
    } finally { this.depth--; }
  }
  async exec(sql: string): Promise<void> { this.binding.exec(sql); }
}

export function openLocalDatabase(filename = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/** Normalise JS values for SQLite (booleans -> 0/1, undefined -> null, objects -> JSON). */
export function v(x: unknown): BindArg {
  if (x === undefined || x === null) return null;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'number' || typeof x === 'string' || typeof x === 'bigint') return x;
  if (x instanceof Uint8Array) return x;
  return JSON.stringify(x);
}
