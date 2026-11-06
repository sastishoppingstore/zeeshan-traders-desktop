-- 0006 — Offline desktop sync: row versioning, soft delete and delta-pull indexes.
--
-- Scope is deliberately the ROW tier (master data) from packages/shared/src/sync.ts.
-- Financial documents (sales, purchases, receipts, ...) are NOT given a `deleted` flag here:
-- the posting engine's invariant is that a posted row is never UPDATEd or DELETEd — a mistake is
-- corrected by a reversal, which already propagates to every client through the replica pull.
--
-- Every table below gets the same three columns:
--   version    optimistic-lock counter. The server owns it; a client push must present the
--              version it read (base_version) or the write is rejected as a conflict.
--   updated_at server-assigned ISO timestamp (UTC, `Date.toISOString()` shape). It is the pull
--              cursor, so it must never come from a client clock.
--   deleted    soft delete. 1 = tombstone. A tombstone is still returned by /sync/pull so that
--              the deletion reaches every other client; nothing is ever hard-deleted.

-- ---------- tables that already carry version + updated_at: only need `deleted` ----------
ALTER TABLE products           ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_categories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE brands             ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE parties            ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees          ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_methods    ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

-- ---------- tables created after the versioning convention: need all three ----------
ALTER TABLE warehouses         ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE warehouses         ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE warehouses         ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_units      ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_units      ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE product_units      ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE unit_conversions   ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE unit_conversions   ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE unit_conversions   ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE expense_categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expense_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE expense_categories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE financial_accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE financial_accounts ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE financial_accounts ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chart_of_accounts  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chart_of_accounts  ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE chart_of_accounts  ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_images     ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_images     ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images     ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_batches    ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_batches    ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE product_batches    ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE business_settings  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE business_settings  ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;

-- ---------- backfill ----------
-- Existing rows become version 1 stamped with the migration time. strftime('%f') yields
-- `SS.mmm`, so the text lines up with new Date().toISOString() and stays sortable against it.
UPDATE products           SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE product_categories SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE brands             SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE parties            SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE employees          SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE payment_methods    SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE warehouses         SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE product_units      SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE unit_conversions   SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE expense_categories SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE financial_accounts SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE chart_of_accounts  SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE product_images     SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE product_batches    SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE business_settings  SET updated_at = COALESCE(NULLIF(updated_at, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ---------- delta-pull indexes ----------
-- /sync/pull filters `updated_at > :since` per table; without this every pull is a full scan,
-- which the EXPLAIN QUERY PLAN gate in CI would (rightly) fail on.
CREATE INDEX IF NOT EXISTS idx_sync_products           ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_product_categories ON product_categories(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_brands             ON brands(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_parties            ON parties(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_employees          ON employees(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_payment_methods    ON payment_methods(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_warehouses         ON warehouses(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_product_units      ON product_units(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_unit_conversions   ON unit_conversions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_expense_categories ON expense_categories(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_financial_accounts ON financial_accounts(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_chart_of_accounts  ON chart_of_accounts(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_product_images     ON product_images(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_product_batches    ON product_batches(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_business_settings  ON business_settings(updated_at);

-- ---------- replica pull indexes (server-derived tables the desktop mirrors) ----------
-- Child-line tables with no timestamp column (journal_lines, *_items, *_return_items) are pulled
-- by `id`, which is the primary key and already indexed. Only non-PK timestamp columns need one.
CREATE INDEX IF NOT EXISTS idx_rep_journal_lines_entry   ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_rep_party_ledger_created  ON party_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_rep_sale_items_created    ON sale_items(created_at);
CREATE INDEX IF NOT EXISTS idx_rep_purchase_items_created ON purchase_items(created_at);
CREATE INDEX IF NOT EXISTS idx_rep_stock_mov_created     ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_rep_documents_created     ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_rep_file_att_upload       ON file_attachments(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_rep_orders_ordered        ON orders(ordered_at);

-- ---------- server-side bookkeeping ----------
-- Which device last pulled what. Purely observational (the desktop owns its real cursor locally);
-- it answers "when did this PC last sync?" in the ops screen without trusting a client report.
CREATE TABLE IF NOT EXISTS sync_device_cursors (
  device_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  cursor TEXT NOT NULL,
  rows_pulled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, entity)
);
CREATE INDEX IF NOT EXISTS idx_sync_cursors_updated ON sync_device_cursors(updated_at);

-- Push idempotency. A desktop that loses the response to a push retries the SAME op_id; the
-- server returns the stored verdict instead of applying the write twice. Without this, a retry
-- after a successful-but-unacknowledged push becomes a version conflict (base_version is now
-- stale) and the client's edit would be discarded as rejected.
CREATE TABLE IF NOT EXISTS sync_row_ops (
  op_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  row_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ACCEPTED','CONFLICT','FAILED')),
  version INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_row_ops_entity ON sync_row_ops(entity, updated_at);
