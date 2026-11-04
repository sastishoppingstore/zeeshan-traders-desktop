-- Hot-path indexes required by the CI EXPLAIN QUERY PLAN gate (scripts/check-query-plans.ts).
-- Date-range lists previously did a full SCAN of documents / sales, which grows with the ledger.
-- All statements are idempotent so applying migrations to an existing local DB is safe.
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date, created_at);
CREATE INDEX IF NOT EXISTS idx_documents_date_type ON documents(date, type);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date, created_at);
CREATE INDEX IF NOT EXISTS idx_party_ledger_date ON party_ledger(date, created_at);
CREATE INDEX IF NOT EXISTS idx_account_txn_date ON account_transactions(date, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_period ON journal_entries(date, period_ym);
CREATE INDEX IF NOT EXISTS idx_sync_idempotency ON sync_operations(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_documents_number_date ON documents(number, date);
