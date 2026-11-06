/**
 * The local queue, exercised without a window.
 *
 * `electron/db.cjs` is the half of the sync design that lives on the shop's machine: a save writes
 * the row, marks it dirty and queues one intention; a pull must never overwrite a dirty row, and a
 * conflict must park both copies instead of dropping one. tests/sync.test.ts covers the server half
 * (real Worker + D1-compatible SQL), so together these are the offline queue acceptance criteria.
 *
 * Runs on the node:sqlite fallback in sqlite-driver.cjs — no Electron and no better-sqlite3 needed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { openLocalDb } = require(`${ROOT}electron/db.cjs`);

const stores: Array<{ close(): void }> = [];
function open() {
  const store = openLocalDb({ file: ':memory:', appRoot: ROOT });
  stores.push(store);
  return store;
}
afterEach(() => { while (stores.length) { try { stores.pop()!.close(); } catch { /* closed */ } } });

const SERVER_ROW = (over: Record<string, unknown> = {}) => ({
  id: 'br-shared-1',
  name_ur: 'سرور',
  name_en: 'Server brand',
  is_active: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  version: 3,
  deleted: 0,
  ...over,
});

describe('desktop local queue (offline create / edit / delete)', () => {
  it('queues one push for a create followed by edits, with the latest payload', () => {
    const store = open();
    const first = store.save('brands', { id: 'br-local-1', name_ur: 'مقامی', name_en: 'Local' });
    expect(first.ok).toBe(true);
    expect(first.row.synced).toBe(0);
    expect(first.row.version).toBe(0);          // never seen by the server yet

    const second = store.save('brands', { id: 'br-local-1', name_ur: 'مقامی', name_en: 'Local edited' });
    expect(second.ok).toBe(true);
    expect(second.queued_as).toBe(first.queued_as);   // coalesced, not duplicated

    expect(store.pendingCount()).toBe(1);
    expect(store.dirtyCount()).toBe(1);
    const [op] = store.outbox.pending('row', 10);
    expect(op.entity).toBe('brands');
    expect(op.base_version).toBe(0);
    expect(JSON.parse(op.payload_json).name_en).toBe('Local edited');
  });

  it('deletes with a tombstone and queues the deletion (never a hard delete)', () => {
    const store = open();
    store.save('brands', { id: 'br-local-2', name_ur: 'حذف', name_en: 'Delete me' });
    const removed = store.remove('brands', 'br-local-2');
    expect(removed.ok).toBe(true);
    expect(removed.deleted).toBe(1);

    const row = store.get('brands', 'br-local-2');
    expect(row.deleted).toBe(1);                // still present, just tombstoned
    expect(store.pendingCount()).toBe(1);       // the tombstone replaced the create in the queue
    const [op] = store.outbox.pending('row', 10);
    expect(op.deleted).toBe(1);
  });

  it('applies a clean server row and marks it synced', () => {
    const store = open();
    const summary = store.applyPullPage({
      brands: { rows: [SERVER_ROW()], cursor: '2026-01-02T00:00:00.000Z', has_more: false },
    });
    expect(summary.applied).toBe(1);
    expect(summary.skipped_dirty).toBe(0);
    const row = store.get('brands', 'br-shared-1');
    expect(row.name_en).toBe('Server brand');
    expect(row.synced).toBe(1);
    expect(row.version).toBe(3);
  });

  it('never overwrites a dirty local row and parks both copies as a conflict', () => {
    const store = open();
    store.save('brands', { id: 'br-shared-1', name_ur: 'مقامی', name_en: 'My edit' });

    const summary = store.applyPullPage({
      brands: { rows: [SERVER_ROW({ name_en: 'Their edit' })], cursor: '2026-01-02T00:00:00.000Z', has_more: false },
    });
    expect(summary.skipped_dirty).toBe(1);
    expect(summary.applied).toBe(0);

    // Local edit survives untouched, and nothing is lost: the server copy is in the conflicts table.
    expect(store.get('brands', 'br-shared-1').name_en).toBe('My edit');
    const [conflict] = store.conflicts.list();
    expect(conflict.reason).toBe('DIRTY_LOCAL');
    expect(conflict.local.name_en).toBe('My edit');
    expect(conflict.server.name_en).toBe('Their edit');
  });

  it('queues a financial document as an intent with a valid created_at and a zero base_version', () => {
    const store = open();
    const out = store.command('EXPENSE', {
      date: '2026-11-04', category_code: 'RENT', amount_paisa: 50000, account_id: 'CASH',
    });
    expect(out.ok).toBe(true);
    const [op] = store.outbox.pending('command', 10);
    expect(op.kind).toBe('command');
    // Regression: the insert bound a timestamp to base_version and left created_at (NOT NULL) unset,
    // so every offline expense threw before it could be queued.
    expect(Number(op.created_at)).toBeGreaterThan(0);
    expect(Number(op.base_version)).toBe(0);
    const body = JSON.parse(op.payload_json);
    expect(body.type).toBe('EXPENSE');
    expect(body.payload.category_code).toBe('RENT');
    expect(store.pendingCount()).toBe(1);
  });

  it('keep_server abandons the local edit but retires the queued push and takes the server version', () => {
    const store = open();
    store.save('brands', { id: 'br-shared-1', name_ur: 'مقامی', name_en: 'My edit' });
    store.applyPullPage({
      brands: { rows: [SERVER_ROW({ name_en: 'Their edit' })], cursor: '2026-01-02T00:00:00.000Z', has_more: false },
    });
    const [conflict] = store.conflicts.list();

    const out = store.conflicts.resolve(conflict.id, 'keep_server');
    expect(out.ok).toBe(true);
    const row = store.get('brands', 'br-shared-1');
    expect(row.synced).toBe(1);
    expect(row.version).toBe(3);
    expect(store.conflicts.openCount()).toBe(0);

    // Only then does a fresh pull replace the row with the server's text.
    store.applyPullPage({
      brands: { rows: [SERVER_ROW({ name_en: 'Their edit' })], cursor: '2026-01-02T00:00:00.001Z', has_more: false },
    });
    expect(store.get('brands', 'br-shared-1').name_en).toBe('Their edit');
  });

  it('reapply_mine re-queues the local edit against the current server version', () => {
    const store = open();
    store.save('brands', { id: 'br-shared-1', name_ur: 'مقامی', name_en: 'My edit' });
    store.applyPullPage({
      brands: { rows: [SERVER_ROW({ name_en: 'Their edit' })], cursor: '2026-01-02T00:00:00.000Z', has_more: false },
    });
    const [conflict] = store.conflicts.list();

    const out = store.conflicts.resolve(conflict.id, 'reapply_mine');
    expect(out.ok).toBe(true);
    const [op] = store.outbox.pending('row', 10);
    expect(op.base_version).toBe(3);            // the version the server is on now
    expect(JSON.parse(op.payload_json).name_en).toBe('My edit');
    expect(store.get('brands', 'br-shared-1').synced).toBe(0);
  });
});
