/**
 * Offline-sync registry — the single source of truth for what the desktop app may sync and how.
 *
 * Three tiers, because this database is NOT a set of independent CRUD tables:
 *   row      — master data. Bidirectional, optimistic-locked by `version`. The client sends
 *              {id, data, base_version, deleted} and the server writes exactly those columns.
 *   command  — financial documents. The client sends an INTENT (an outbox operation) and the
 *              server's posting engine derives stock movements, journals and balances. A client
 *              that wrote these rows directly would double-count stock and unbalance the ledger.
 *   replica  — server-derived or auth-owned data. Downloaded so the desktop works and prints
 *              offline; the server NEVER accepts a client write for it.
 *
 * The worker, the Electron main process and the tests all import this file, so a tier can never
 * drift between them.
 */

export type SyncTier = 'row' | 'command' | 'replica';

export interface RowEntity {
  entity: string;
  table: string;
  tier: 'row';
  /** Primary key column — `id` for almost all, but settings/CoA are keyed by name/code. */
  pk: string;
  /** Columns a client may set. Everything else (slug, book_code, is_system, created_*,
   *  opening balances, cnic_enc, qr_key) is server-owned. This list IS the validation boundary. */
  columns: string[];
  readPerm: string;
  writePerm: string;
  /** The tables in this schema are not uniform about bookkeeping columns: some carry created_at
   *  and/or created_by, several carry neither. Declared here rather than discovered with PRAGMA so
   *  a push never issues an extra round-trip, and asserted against the schema by tests/sync.test.ts. */
  has_created_at: boolean;
  has_created_by: boolean;
  /** NOT NULL columns with no default that a client MUST supply when creating a record. Checked
   *  before the batch runs, because one invalid record would otherwise roll back the whole batch
   *  (both D1 and the local adapter execute it as one implicit transaction). */
  required: string[];
  /** Slug is generated, never accepted from a client — the public product URL depends on it being
   *  unique and normalised, which only the server can guarantee. */
  derive_slug?: boolean;
}

export interface CommandEntity {
  entity: string;
  tier: 'command';
  /** Value accepted by the existing `syncOperationSchema.type` / dispatch() switch. */
  opType: string;
  table: string;
  pk: string;
  readPerm: string;
  writePerm: string;
}

export interface ReplicaEntity {
  entity: string;
  table: string;
  tier: 'replica';
  pk: string;
  /** Column used to slice the delta. `updated_at` for aggregates, a `*_at` column where one
   *  exists, and `id` for child-line tables that carry no timestamp at all — ids are ULIDs, so
   *  they are themselves creation-ordered and therefore a legal append-only cursor. */
  cursor: string;
  /** true  -> re-send the whole table each sync (small, recomputed in place, no history).
   *  false -> send only rows with <cursor> > since. */
  full_refresh?: boolean;
  readPerm: string;
  /** Composite keys are possible in this schema (stock_batch_balance), so pulls may need it. */
  pk_cols?: string[];
}

export type SyncEntity = RowEntity | CommandEntity | ReplicaEntity;

// ------------------------------------------------------------------ row tier ----
export const ROW_ENTITIES: RowEntity[] = [
  {
    tier: 'row',
    entity: 'products', table: 'products', pk: 'id', readPerm: 'products.read', writePerm: 'products.write',
    required: ['name_ur','category_id','base_unit','purchase_unit','sale_unit'], derive_slug: true,
    has_created_at: true, has_created_by: true,
    columns: ['name_ur', 'name_en', 'category_id', 'brand_id', 'sku', 'barcode', 'description_ur', 'description_en',
      'base_unit', 'purchase_unit', 'sale_unit', 'conversion_ratio_milli', 'grams_per_base_unit', 'track_batch',
      'track_expiry', 'is_pesticide', 'reorder_level_milli', 'purchase_rate_paisa', 'sale_rate_paisa',
      'tax_pct_milli', 'show_public_price', 'public_price_paisa', 'availability_mode', 'is_published',
      'is_featured', 'is_active', 'seo_title', 'seo_description', 'season'],
  },
  {
    tier: 'row',
    entity: 'categories', table: 'product_categories', pk: 'id', readPerm: 'catalogue.read', writePerm: 'catalogue.write',
    required: ['code','name_ur'], derive_slug: true,
    has_created_at: true, has_created_by: true,
    columns: ['code', 'parent_id', 'name_ur', 'name_en', 'icon', 'sort', 'is_active'],
  },
  {
    tier: 'row',
    entity: 'brands', table: 'brands', pk: 'id', readPerm: 'catalogue.read', writePerm: 'catalogue.write',
    required: ['name_ur'],
    has_created_at: true, has_created_by: false,
    columns: ['name_ur', 'name_en', 'is_active'],
  },
  {
    // Opening balance / direction / date / CNIC are deliberately absent: they post a journal and
    // need the encryption key, so party *creation* goes through the PARTY command instead.
    tier: 'row',
    entity: 'parties', table: 'parties', pk: 'id', readPerm: 'parties.read', writePerm: 'parties.write',
    required: ['name_ur','type'],
    has_created_at: true, has_created_by: true,
    columns: ['name_ur', 'name_en', 'phone', 'village', 'type', 'credit_limit_paisa', 'notes', 'is_active'],
  },
  {
    tier: 'row',
    entity: 'employees', table: 'employees', pk: 'id', readPerm: 'employees.read', writePerm: 'employees.write',
    required: ['name','join_date'],
    has_created_at: true, has_created_by: false,
    columns: ['name', 'role', 'phone', 'join_date', 'base_salary_paisa', 'status'],
  },
  {
    tier: 'row',
    entity: 'warehouses', table: 'warehouses', pk: 'id', readPerm: 'stock.read', writePerm: 'stock.adjust',
    required: ['code','name_ur'],
    has_created_at: false, has_created_by: false,
    columns: ['code', 'name_ur', 'is_default'],
  },
  {
    tier: 'row',
    entity: 'product_units', table: 'product_units', pk: 'id', readPerm: 'products.read', writePerm: 'products.write',
    required: ['product_id','unit_code','ratio_milli'],
    has_created_at: false, has_created_by: false,
    columns: ['product_id', 'unit_code', 'ratio_milli', 'is_base'],
  },
  {
    tier: 'row',
    entity: 'unit_conversions', table: 'unit_conversions', pk: 'id', readPerm: 'products.read', writePerm: 'products.write',
    required: ['from_unit','to_unit','ratio_milli'],
    has_created_at: true, has_created_by: false,
    columns: ['from_unit', 'to_unit', 'ratio_milli', 'confirmed'],
  },
  {
    tier: 'row',
    entity: 'expense_categories', table: 'expense_categories', pk: 'id', readPerm: 'expenses.read', writePerm: 'expenses.post',
    required: ['code','name_ur','name_en','group_code','gl_code'],
    has_created_at: false, has_created_by: false,
    columns: ['code', 'name_ur', 'name_en', 'group_code', 'gl_code'],
  },
  {
    // opening_balance_paisa excluded — it needs a journal entry.
    tier: 'row',
    entity: 'financial_accounts', table: 'financial_accounts', pk: 'id', readPerm: 'accounts.read', writePerm: 'accounts.write',
    required: ['code','name_ur','name_en','type','gl_code'],
    has_created_at: false, has_created_by: false,
    columns: ['code', 'name_ur', 'name_en', 'type', 'gl_code', 'opening_date', 'is_active'],
  },
  {
    tier: 'row',
    entity: 'chart_of_accounts', table: 'chart_of_accounts', pk: 'code', readPerm: 'accounting.read', writePerm: 'accounts.write',
    required: ['name_ur','name_en','type'],
    has_created_at: false, has_created_by: false,
    columns: ['name_ur', 'name_en', 'type', 'parent_code', 'is_active'],
  },
  {
    // account_id / qr_key excluded: they bind a bank account and an R2 media key.
    tier: 'row',
    entity: 'payment_methods', table: 'payment_methods', pk: 'id', readPerm: 'khata.read', writePerm: 'payments.methods.write',
    required: ['kind','title_ur'],
    has_created_at: true, has_created_by: false,
    columns: ['kind', 'title_ur', 'title_en', 'bank_name', 'account_title', 'account_number', 'iban',
      'mobile_number', 'instructions_ur', 'sort', 'is_active'],
  },
  {
    tier: 'row',
    entity: 'product_batches', table: 'product_batches', pk: 'id', readPerm: 'stock.read', writePerm: 'stock.adjust',
    required: ['product_id','batch_no'],
    has_created_at: true, has_created_by: false,
    columns: ['product_id', 'batch_no', 'mfg_date', 'expiry_date', 'manufacturer', 'active_ingredient', 'quarantined'],
  },
  {
    // Keyed by setting name, and `value` is stored as a JSON string by setSetting().
    tier: 'row',
    entity: 'settings', table: 'business_settings', pk: 'key', readPerm: 'settings.read', writePerm: 'settings.write',
    required: ['value'],
    has_created_at: false, has_created_by: false,
    columns: ['value'],
  },
];

// -------------------------------------------------------------- command tier ----
/** Mirrors dispatch() in apps/worker/src/routes/ops.ts — no new server write path is invented. */
export const COMMAND_ENTITIES: CommandEntity[] = [
  {
    tier: 'command',
    entity: 'sale', table: 'sales', pk: 'id', opType: 'SALE', readPerm: 'sales.read', writePerm: 'sales.post' },
  {
    tier: 'command',
    entity: 'purchase', table: 'purchases', pk: 'id', opType: 'PURCHASE', readPerm: 'purchases.read', writePerm: 'purchases.post' },
  {
    tier: 'command',
    entity: 'receipt', table: 'receipts', pk: 'id', opType: 'RECEIPT', readPerm: 'khata.read', writePerm: 'receipts.post' },
  {
    tier: 'command',
    entity: 'payment', table: 'payments', pk: 'id', opType: 'PAYMENT', readPerm: 'khata.read', writePerm: 'payments.post' },
  {
    tier: 'command',
    entity: 'expense', table: 'expenses', pk: 'id', opType: 'EXPENSE', readPerm: 'expenses.read', writePerm: 'expenses.post' },
  {
    tier: 'command',
    entity: 'grain_purchase', table: 'grain_weighments', pk: 'id', opType: 'GRAIN_PURCHASE', readPerm: 'grains.read', writePerm: 'grains.post' },
  {
    tier: 'command',
    entity: 'grain_sale', table: 'grain_weighments', pk: 'id', opType: 'GRAIN_SALE', readPerm: 'grains.read', writePerm: 'grains.post' },
  {
    tier: 'command',
    entity: 'party', table: 'parties', pk: 'id', opType: 'PARTY', readPerm: 'parties.read', writePerm: 'parties.write' },
];

// --------------------------------------------------------------- replica tier ----
export const REPLICA_ENTITIES: ReplicaEntity[] = [
  // financial documents + their lines (arrive with the doc; a client may not write them alone)
  ...[
    ['sales', 'sales', 'created_at', 'sales.read'],
    ['sale_items', 'sale_items', 'created_at', 'sales.read'],
    ['purchases', 'purchases', 'created_at', 'purchases.read'],
    ['purchase_items', 'purchase_items', 'created_at', 'purchases.read'],
    ['receipts', 'receipts', 'created_at', 'khata.read'],
    ['payments', 'payments', 'created_at', 'khata.read'],
    ['expenses', 'expenses', 'created_at', 'expenses.read'],
    ['sales_returns', 'sales_returns', 'created_at', 'returns.read'],
    ['sale_return_items', 'sale_return_items', 'id', 'returns.read'],
    ['purchase_returns', 'purchase_returns', 'created_at', 'returns.read'],
    ['purchase_return_items', 'purchase_return_items', 'id', 'returns.read'],
    ['grain_weighments', 'grain_weighments', 'created_at', 'grains.read'],
    ['grain_deductions', 'grain_deductions', 'id', 'grains.read'],
    ['grain_lots', 'grain_lots', 'opened_at', 'grains.read'],
    ['stock_adjustments', 'stock_adjustments', 'created_at', 'stock.read'],
    ['stock_counts', 'stock_counts', 'created_at', 'stock.read'],
    ['stock_count_lines', 'stock_count_lines', 'id', 'stock.read'],
    ['stock_movements', 'stock_movements', 'created_at', 'stock.read'],
    ['stock_openings', 'stock_openings', 'created_at', 'stock.read'],
    ['transfers', 'transfers', 'created_at', 'accounts.read'],
    ['quotations', 'quotations', 'created_at', 'orders.read'],
    ['quotation_items', 'quotation_items', 'id', 'orders.read'],
    ['orders', 'orders', 'ordered_at', 'orders.read'],
    ['order_items', 'order_items', 'id', 'orders.read'],
    ['payment_allocations', 'payment_allocations', 'created_at', 'khata.read'],
    ['payment_proofs', 'payment_proofs', 'uploaded_at', 'khata.read'],
    ['employee_advances', 'employee_advances', 'created_at', 'employees.read'],
    ['salary_records', 'salary_records', 'created_at', 'employees.read'],
    ['salary_payments', 'salary_payments', 'created_at', 'employees.read'],
    ['party_ledger', 'party_ledger', 'created_at', 'khata.read'],
    ['party_opening_balances', 'party_opening_balances', 'created_at', 'khata.read'],
    ['account_transactions', 'account_transactions', 'created_at', 'accounts.read'],
    ['account_reconciliations', 'account_reconciliations', 'created_at', 'accounts.read'],
    ['journal_entries', 'journal_entries', 'created_at', 'accounting.read'],
    ['journal_lines', 'journal_lines', 'id', 'accounting.read'],
    ['documents', 'documents', 'created_at', 'documents.read'],
    ['file_attachments', 'file_attachments', 'uploaded_at', 'documents.read'],
    ['audit_logs', 'audit_logs', 'created_at', 'audit.read'],
    ['website_pages', 'website_pages', 'updated_at', 'cms.read', 'slug'],
    ['website_banners', 'website_banners', 'updated_at', 'cms.read'],
    ['website_announcements', 'website_announcements', 'updated_at', 'cms.read'],
    ['website_enquiries', 'website_enquiries', 'updated_at', 'orders.read'],
    ['website_enquiry_items', 'website_enquiry_items', 'id', 'orders.read'],
    ['users', 'users', 'updated_at', 'users.read'],
    ['sessions', 'sessions', 'created_at', 'users.read'],
    ['devices', 'devices', 'registered_at', 'users.read'],
    ['sync_operations', 'sync_operations', 'created_at', 'sync.read'],
    ['sync_conflicts', 'sync_conflicts', 'created_at', 'sync.read'],
    // Optional 5th element: the primary key, when the table does not use `id`.
  ].map(([entity, table, cursor, readPerm, pk]) => ({
    entity, table, tier: 'replica' as const, pk: pk ?? 'id', cursor, readPerm,
  })),
  // recomputed in place — no history worth delta-slicing, and small enough to re-send whole
  { entity: 'product_images', table: 'product_images', tier: 'replica', pk: 'id', cursor: 'created_at', readPerm: 'products.read' },
  { entity: 'stock_balance', table: 'stock_balance', tier: 'replica', pk: 'product_id', pk_cols: ['product_id', 'warehouse_id'], cursor: 'updated_at', full_refresh: true, readPerm: 'stock.read' },
  { entity: 'stock_batch_balance', table: 'stock_batch_balance', tier: 'replica', pk: 'batch_id', pk_cols: ['batch_id', 'warehouse_id'], cursor: 'updated_at', full_refresh: true, readPerm: 'stock.read' },
  { entity: 'party_balance', table: 'party_balance', tier: 'replica', pk: 'party_id', cursor: 'updated_at', full_refresh: true, readPerm: 'khata.read' },
  { entity: 'account_balance', table: 'account_balance', tier: 'replica', pk: 'account_id', cursor: 'updated_at', full_refresh: true, readPerm: 'accounts.read' },
  { entity: 'daily_summary', table: 'daily_summary', tier: 'replica', pk: 'date', pk_cols: ['date', 'book_code', 'metric'], cursor: 'updated_at', full_refresh: true, readPerm: 'reports.view' },
  { entity: 'invoice_sequences', table: 'invoice_sequences', tier: 'replica', pk: 'code', cursor: 'updated_at', full_refresh: true, readPerm: 'documents.read' },
];

export const ALL_ENTITIES: SyncEntity[] = [...ROW_ENTITIES, ...COMMAND_ENTITIES, ...REPLICA_ENTITIES];

const BY_NAME = new Map<string, SyncEntity>(ALL_ENTITIES.map((e) => [e.entity, e]));
const BY_TABLE = new Map<string, SyncEntity>(ALL_ENTITIES.map((e) => [`${e.tier}:${e.table}`, e]));

export const entityOf = (name: string): SyncEntity | undefined => BY_NAME.get(name);
export const rowEntity = (name: string): RowEntity | undefined => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'row' ? e : undefined;
};
export const commandEntity = (name: string): CommandEntity | undefined => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'command' ? e : undefined;
};
export const commandEntityByOpType = (opType: string): CommandEntity | undefined =>
  COMMAND_ENTITIES.find((e) => e.opType === opType);
export const replicaEntity = (name: string): ReplicaEntity | undefined => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'replica' ? e : undefined;
};
export const replicaByTable = (table: string): ReplicaEntity | undefined =>
  REPLICA_ENTITIES.find((e) => e.table === table);

/** Table names owned by the sync layer — used to prove no table was forgotten. */
export const SYNCED_TABLES = new Set(ALL_ENTITIES.map((e) => e.table));

export interface PushRowOp {
  /** Client-generated (uuid). Re-sending the same op_id returns the stored verdict instead of
   *  applying the write twice — this is what makes a retry after a lost response safe. */
  op_id: string;
  entity: string;
  id: string;
  data: Record<string, unknown>;
  base_version: number;
  deleted?: 0 | 1;
}

export interface PushRowResult {
  accepted: { id: string; entity: string; version: number; updated_at: string }[];
  conflicts: { id: string; entity: string; reason: 'VERSION' | 'NOT_PERMITTED' | 'INVALID'; server?: Record<string, unknown>; message?: string }[];
  failed: { id: string; entity: string; code: string; message: string }[];
}

/** Clamp a client-supplied column bag to the entity whitelist and SQLite-safe scalars. */
export function sanitizeRowData(def: RowEntity, raw: unknown): Record<string, string | number | null> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, string | number | null> = {};
  for (const col of def.columns) {
    const value = src[col];
    if (value === undefined) continue;
    if (value === null) { out[col] = null; continue; }
    // Only scalars survive; objects and arrays are never legitimate column values in this schema.
    if (typeof value === 'boolean') out[col] = value ? 1 : 0;
    else if (typeof value === 'string' || typeof value === 'number') out[col] = value;
    // Objects/arrays are never legitimate column values in this schema: drop them.
  }
  return out;
}
