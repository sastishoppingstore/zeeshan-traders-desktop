-- Zeeshan Traders — D1 (SQLite) schema, migration 0001.
-- H1: money = INTEGER paisa; quantity = INTEGER milli-units of the product's base unit.
-- H2: posted financial tables have no UPDATE/DELETE grants in code; corrections are reversals.
-- All mutable tables carry created_at / created_by / updated_at / version.
-- Foreign keys are enforced (D1 default; PRAGMA foreign_keys=ON in the local adapter).

CREATE TABLE IF NOT EXISTS business_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                 -- JSON-encoded value
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 310000,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  description_ur TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf TEXT NOT NULL,
  device_id TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL DEFAULT '',
  registered_at TEXT NOT NULL,
  revoked_at TEXT,
  last_sync_at TEXT,
  pin_salt TEXT,
  pin_hash TEXT,
  pin_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, registered_at);

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL,
  title_ur TEXT NOT NULL,
  body_ur TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  code TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  ym TEXT PRIMARY KEY,                 -- YYYY-MM
  closed_at TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  reason TEXT NOT NULL
);

-- ------------------------------- Website -------------------------------
CREATE TABLE IF NOT EXISTS website_pages (
  slug TEXT PRIMARY KEY,
  title_ur TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  body_ur TEXT NOT NULL DEFAULT '',
  body_en TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (status IN ('DRAFT','PUBLISHED','REVIEW_REQUIRED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS website_banners (
  id TEXT PRIMARY KEY,
  title_ur TEXT NOT NULL,
  image_r2_key TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  active_from TEXT,
  active_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_banners_active ON website_banners(is_active, sort);

CREATE TABLE IF NOT EXISTS website_announcements (
  id TEXT PRIMARY KEY,
  title_ur TEXT NOT NULL,
  body_ur TEXT NOT NULL DEFAULT '',
  publish_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_announcements_publish ON website_announcements(is_active, publish_at);

CREATE TABLE IF NOT EXISTS website_enquiries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  city TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEW','APPROVED','REJECTED','CONVERTED')),
  reject_reason TEXT,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON website_enquiries(status, created_at);
CREATE INDEX IF NOT EXISTS idx_enquiries_date ON website_enquiries(created_at);

CREATE TABLE IF NOT EXISTS website_enquiry_items (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES website_enquiries(id),
  product_id TEXT,
  qty_milli INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_enquiry_items ON website_enquiry_items(enquiry_id);

-- ------------------------------ Catalogue ------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES product_categories(id),
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  book_code TEXT,
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_categories_publish ON product_categories(is_active, sort);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES product_categories(id),
  brand_id TEXT REFERENCES brands(id),
  sku TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  description_ur TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  base_unit TEXT NOT NULL,
  purchase_unit TEXT NOT NULL,
  sale_unit TEXT NOT NULL,
  conversion_ratio_milli INTEGER NOT NULL DEFAULT 1000 CHECK (conversion_ratio_milli > 0),
  grams_per_base_unit INTEGER NOT NULL DEFAULT 0 CHECK (grams_per_base_unit >= 0),
  track_batch INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  is_pesticide INTEGER NOT NULL DEFAULT 0,
  reorder_level_milli INTEGER NOT NULL DEFAULT 0,
  purchase_rate_paisa INTEGER NOT NULL DEFAULT 0 CHECK (purchase_rate_paisa >= 0),
  sale_rate_paisa INTEGER NOT NULL DEFAULT 0 CHECK (sale_rate_paisa >= 0),
  tax_pct_milli INTEGER NOT NULL DEFAULT 0,
  show_public_price INTEGER NOT NULL DEFAULT 0,
  public_price_paisa INTEGER NOT NULL DEFAULT 0 CHECK (public_price_paisa >= 0),
  availability_mode TEXT NOT NULL DEFAULT 'AUTO' CHECK (availability_mode IN ('AUTO','ALWAYS','CALL')),
  is_published INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL DEFAULT 'NONE',
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products(sku) WHERE sku <> '';
CREATE INDEX IF NOT EXISTS idx_products_publish ON products(is_active, is_published, category_id, name_ur);
CREATE INDEX IF NOT EXISTS idx_products_publish2 ON products(is_published, is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(is_featured, is_published, created_at);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name_ur);

CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_code TEXT NOT NULL,
  ratio_milli INTEGER NOT NULL CHECK (ratio_milli > 0),
  is_base INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, unit_code)
);

CREATE TABLE IF NOT EXISTS unit_conversions (
  id TEXT PRIMARY KEY,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  ratio_milli INTEGER NOT NULL CHECK (ratio_milli > 0),
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (from_unit, to_unit)
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  r2_key TEXT NOT NULL,
  alt_ur TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, sort);

CREATE TABLE IF NOT EXISTS product_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_no TEXT NOT NULL,
  mfg_date TEXT,
  expiry_date TEXT,
  manufacturer TEXT NOT NULL DEFAULT '',
  active_ingredient TEXT NOT NULL DEFAULT '',
  quarantined INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, batch_no)
);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id, expiry_date);

-- -------------------------------- Parties -------------------------------
CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  village TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('CUSTOMER','SUPPLIER','FARMER','EMPLOYEE')),
  opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
  opening_direction TEXT NOT NULL DEFAULT 'RECEIVABLE' CHECK (opening_direction IN ('RECEIVABLE','PAYABLE')),
  opening_date TEXT,
  credit_limit_paisa INTEGER NOT NULL DEFAULT 0,
  cnic_enc TEXT,                     -- AES-GCM ciphertext, never plaintext
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_parties_type ON parties(type, is_active, name_ur);
CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties(phone);

CREATE TABLE IF NOT EXISTS party_opening_balances (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  amount_paisa INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('RECEIVABLE','PAYABLE')),
  as_of_date TEXT NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_party_openings ON party_opening_balances(party_id, as_of_date);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  join_date TEXT NOT NULL,
  base_salary_paisa INTEGER NOT NULL DEFAULT 0 CHECK (base_salary_paisa >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- --------------------------------- Stock --------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ur TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_openings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES product_batches(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost_paisa INTEGER NOT NULL CHECK (unit_cost_paisa >= 0),
  date TEXT NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_openings ON stock_openings(product_id, date);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES product_batches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty_in_milli INTEGER NOT NULL DEFAULT 0 CHECK (qty_in_milli >= 0),
  qty_out_milli INTEGER NOT NULL DEFAULT 0 CHECK (qty_out_milli >= 0),
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_paisa >= 0),
  cost_total_paisa INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  book_code TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT,
  CHECK (qty_in_milli > 0 OR qty_out_milli > 0),
  CHECK (qty_in_milli = 0 OR qty_out_milli = 0)
);
CREATE INDEX IF NOT EXISTS idx_movements_product_date ON stock_movements(product_id, date);
CREATE INDEX IF NOT EXISTS idx_movements_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_movements_book_date ON stock_movements(book_code, date);
CREATE INDEX IF NOT EXISTS idx_movements_batch ON stock_movements(batch_id, date);

CREATE TABLE IF NOT EXISTS stock_balance (
  product_id TEXT NOT NULL REFERENCES products(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty_milli INTEGER NOT NULL DEFAULT 0,
  value_paisa INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_balance_wh ON stock_balance(warehouse_id, product_id);

CREATE TABLE IF NOT EXISTS stock_batch_balance (
  batch_id TEXT NOT NULL REFERENCES product_batches(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty_milli INTEGER NOT NULL DEFAULT 0,
  value_paisa INTEGER NOT NULL DEFAULT 0,
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  book_code TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_counts_date ON stock_counts(status, date);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  system_milli INTEGER NOT NULL DEFAULT 0,
  counted_milli INTEGER NOT NULL DEFAULT 0,
  variance_milli INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_count_lines ON stock_count_lines(count_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES product_batches(id),
  delta_milli INTEGER NOT NULL,
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_adjustments_product_date ON stock_adjustments(product_id, date);

-- --------------------------- Purchases / Sales --------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  book_code TEXT NOT NULL,
  module_code TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties(id),
  supplier_invoice_no TEXT NOT NULL DEFAULT '',
  season TEXT NOT NULL DEFAULT 'NONE',
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  freight_paisa INTEGER NOT NULL DEFAULT 0,
  loading_paisa INTEGER NOT NULL DEFAULT 0,
  other_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa INTEGER NOT NULL,
  paid_paisa INTEGER NOT NULL DEFAULT 0,
  due_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT','POSTED','REVERSED')),
  note TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE,
  provisional INTEGER NOT NULL DEFAULT 0,
  reversal_of TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_purchases_book_date ON purchases(book_code, date);
CREATE INDEX IF NOT EXISTS idx_purchases_party_date ON purchases(party_id, date);
CREATE INDEX IF NOT EXISTS idx_purchases_status_date ON purchases(status, date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES product_batches(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  rate_paisa INTEGER NOT NULL,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  landed_cost_paisa INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL,
  unit_cost_paisa INTEGER NOT NULL DEFAULT 0,
  bags INTEGER NOT NULL DEFAULT 0,
  weight_per_bag_grams INTEGER NOT NULL DEFAULT 0,
  manufacturer TEXT NOT NULL DEFAULT '',
  mfg_date TEXT,
  expiry_date TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items(product_id);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  book_code TEXT NOT NULL,
  module_code TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties(id),
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_mobile TEXT NOT NULL DEFAULT '',
  buyer_address TEXT NOT NULL DEFAULT '',
  cnic_enc TEXT,
  season TEXT NOT NULL DEFAULT 'NONE',
  subtotal_paisa INTEGER NOT NULL DEFAULT 0,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa INTEGER NOT NULL,
  cost_paisa INTEGER NOT NULL DEFAULT 0,
  paid_paisa INTEGER NOT NULL DEFAULT 0,
  due_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT','POSTED','REVERSED')),
  note TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE,
  provisional INTEGER NOT NULL DEFAULT 0,
  reversal_of TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sales_book_date ON sales(book_code, date);
CREATE INDEX IF NOT EXISTS idx_sales_party_date ON sales(party_id, date);
CREATE INDEX IF NOT EXISTS idx_sales_status_date ON sales(status, date);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES product_batches(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  rate_paisa INTEGER NOT NULL,
  discount_paisa INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL,
  cost_paisa INTEGER NOT NULL DEFAULT 0,
  returned_milli INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS sales_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  total_paisa INTEGER NOT NULL,
  cost_paisa INTEGER NOT NULL,
  refund_method TEXT NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_returns_date ON sales_returns(date);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(id),
  line_id TEXT NOT NULL REFERENCES sale_items(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  amount_paisa INTEGER NOT NULL,
  cost_paisa INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  total_paisa INTEGER NOT NULL,
  refund_method TEXT NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON purchase_returns(date);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES purchase_returns(id),
  line_id TEXT NOT NULL REFERENCES purchase_items(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  amount_paisa INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  enquiry_id TEXT,
  party_id TEXT REFERENCES parties(id),
  date TEXT NOT NULL,
  total_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id),
  product_id TEXT REFERENCES products(id),
  qty_milli INTEGER NOT NULL DEFAULT 0,
  rate_paisa INTEGER NOT NULL DEFAULT 0
);

-- -------------------------------- Grains --------------------------------
CREATE TABLE IF NOT EXISTS grain_lots (
  id TEXT PRIMARY KEY,
  crop TEXT NOT NULL,
  lot_no TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  opened_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (crop, lot_no)
);
CREATE INDEX IF NOT EXISTS idx_grain_lots_crop ON grain_lots(crop, opened_at);

CREATE TABLE IF NOT EXISTS grain_weighments (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES grain_lots(id),
  crop TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  date TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  gross_grams INTEGER NOT NULL DEFAULT 0,
  bags INTEGER NOT NULL DEFAULT 0,
  tare_per_bag_grams INTEGER NOT NULL DEFAULT 0,
  tare_grams INTEGER NOT NULL DEFAULT 0,
  deduction_grams INTEGER NOT NULL DEFAULT 0,
  net_grams INTEGER NOT NULL,
  rate_paisa INTEGER NOT NULL DEFAULT 0,
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  arithmetic TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weighments_lot ON grain_weighments(lot_id, date);
CREATE INDEX IF NOT EXISTS idx_weighments_crop_date ON grain_weighments(crop, date);

CREATE TABLE IF NOT EXISTS grain_deductions (
  id TEXT PRIMARY KEY,
  weighment_id TEXT NOT NULL REFERENCES grain_weighments(id),
  type TEXT NOT NULL,
  basis TEXT NOT NULL,
  value INTEGER NOT NULL,
  weight_grams INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_grain_deductions ON grain_deductions(weighment_id);

-- ---------------------------- Money / Accounts --------------------------
CREATE TABLE IF NOT EXISTS financial_accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash','wallet','bank')),
  gl_code TEXT NOT NULL,
  opening_balance_paisa INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS account_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  description_ur TEXT NOT NULL DEFAULT '',
  matched INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_txn_account_date ON account_transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_account_txn_ref ON account_transactions(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  from_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  to_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  note TEXT NOT NULL DEFAULT '',
  journal_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(date);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties(id),
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  allocate_mode TEXT NOT NULL DEFAULT 'AUTO',
  advance_paisa INTEGER NOT NULL DEFAULT 0,
  journal_id TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE,
  provisional INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_party_date ON receipts(party_id, date);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties(id),
  payee_type TEXT NOT NULL DEFAULT 'SUPPLIER',
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  allocate_mode TEXT NOT NULL DEFAULT 'AUTO',
  advance_paisa INTEGER NOT NULL DEFAULT 0,
  journal_id TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE,
  provisional INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_party_date ON payments(party_id, date);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  receipt_id TEXT,
  payment_id TEXT,
  invoice_id TEXT NOT NULL,
  invoice_type TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  created_at TEXT NOT NULL,
  CHECK (receipt_id IS NOT NULL OR payment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_allocations_receipt ON payment_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON payment_allocations(invoice_type, invoice_id);

CREATE TABLE IF NOT EXISTS account_reconciliations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  period TEXT NOT NULL,
  statement_balance_paisa INTEGER NOT NULL,
  ledger_balance_paisa INTEGER NOT NULL,
  difference_paisa INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (account_id, period)
);

-- --------------------------- Expenses / Payroll -------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL,
  group_code TEXT NOT NULL,
  gl_code TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  vendor TEXT NOT NULL DEFAULT '',
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  note TEXT NOT NULL DEFAULT '',
  journal_id TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE,
  provisional INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category_date ON expenses(category_id, date);
CREATE INDEX IF NOT EXISTS idx_expenses_status_date ON expenses(status, date);

CREATE TABLE IF NOT EXISTS employee_advances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
  recovered_paisa INTEGER NOT NULL DEFAULT 0,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  note TEXT NOT NULL DEFAULT '',
  journal_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advances_employee ON employee_advances(employee_id, date);

CREATE TABLE IF NOT EXISTS salary_records (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  ym TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  gross_paisa INTEGER NOT NULL,
  advance_recovered_paisa INTEGER NOT NULL DEFAULT 0,
  deductions_paisa INTEGER NOT NULL DEFAULT 0,
  net_paisa INTEGER NOT NULL,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  status TEXT NOT NULL DEFAULT 'POSTED',
  journal_id TEXT,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE (employee_id, ym)
);
CREATE INDEX IF NOT EXISTS idx_salary_ym ON salary_records(ym, pay_date);

CREATE TABLE IF NOT EXISTS salary_payments (
  id TEXT PRIMARY KEY,
  salary_id TEXT NOT NULL REFERENCES salary_records(id),
  advance_id TEXT REFERENCES employee_advances(id),
  amount_paisa INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- ------------------------------ Accounting ------------------------------
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  code TEXT PRIMARY KEY,
  name_ur TEXT NOT NULL,
  name_en TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  parent_code TEXT,
  is_system INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  period_ym TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  memo_ur TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  is_reversal INTEGER NOT NULL DEFAULT 0,
  reverses_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_ref ON journal_entries(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_journal_period ON journal_entries(period_ym, date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  debit_paisa INTEGER NOT NULL DEFAULT 0 CHECK (debit_paisa >= 0),
  credit_paisa INTEGER NOT NULL DEFAULT 0 CHECK (credit_paisa >= 0),
  party_id TEXT,
  book_code TEXT,
  memo TEXT NOT NULL DEFAULT '',
  CHECK (debit_paisa > 0 OR credit_paisa > 0),
  CHECK (debit_paisa = 0 OR credit_paisa = 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code, entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_book ON journal_lines(book_code, entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_party ON journal_lines(party_id, entry_id);

CREATE TABLE IF NOT EXISTS party_ledger (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties(id),
  book_code TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  description_ur TEXT NOT NULL DEFAULT '',
  debit_paisa INTEGER NOT NULL DEFAULT 0 CHECK (debit_paisa >= 0),
  credit_paisa INTEGER NOT NULL DEFAULT 0 CHECK (credit_paisa >= 0),
  created_at TEXT NOT NULL,
  CHECK (debit_paisa > 0 OR credit_paisa > 0)
);
CREATE INDEX IF NOT EXISTS idx_party_ledger_party_date ON party_ledger(party_id, date);
CREATE INDEX IF NOT EXISTS idx_party_ledger_book_date ON party_ledger(book_code, date);
CREATE INDEX IF NOT EXISTS idx_party_ledger_ref ON party_ledger(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS daily_summary (
  date TEXT NOT NULL,
  book_code TEXT NOT NULL,
  metric TEXT NOT NULL,
  value_paisa INTEGER NOT NULL DEFAULT 0,
  value_milli INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date, book_code, metric)
);
CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_summary(date, metric);

CREATE TABLE IF NOT EXISTS account_balance (
  account_id TEXT PRIMARY KEY REFERENCES financial_accounts(id),
  balance_paisa INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS party_balance (
  party_id TEXT PRIMARY KEY REFERENCES parties(id),
  balance_paisa INTEGER NOT NULL DEFAULT 0,   -- positive = they owe us (receivable)
  updated_at TEXT NOT NULL
);

-- --------------------------- Documents / Files --------------------------
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  number TEXT NOT NULL,
  party_id TEXT,
  date TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  book_code TEXT,
  ref_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  template_version TEXT NOT NULL,
  r2_key TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_type_date ON documents(type, date);
CREATE INDEX IF NOT EXISTS idx_documents_number ON documents(number);
CREATE INDEX IF NOT EXISTS idx_documents_party ON documents(party_id, date);

CREATE TABLE IF NOT EXISTS file_attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON file_attachments(entity_type, entity_id);

-- ------------------------------ Sync / Ops ------------------------------
CREATE TABLE IF NOT EXISTS sync_operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  local_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SYNCED' CHECK (status IN ('PENDING','SYNCED','CONFLICT','FAILED')),
  tries INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  server_doc_id TEXT,
  server_number TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_operations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_device ON sync_operations(device_id, created_at);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES sync_operations(id),
  code TEXT NOT NULL,
  message_ur TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','REJECTED')),
  resolved_at TEXT,
  resolved_by TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON sync_conflicts(status, created_at);

CREATE TABLE IF NOT EXISTS backup_logs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  staging_restore_result TEXT NOT NULL DEFAULT 'NOT_TESTED'
);
CREATE INDEX IF NOT EXISTS idx_backups_at ON backup_logs(at);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  at TEXT NOT NULL,
  result TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_jobs_job ON job_runs(job, at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS usage_counters (
  day TEXT PRIMARY KEY,
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  public_hits INTEGER NOT NULL DEFAULT 0,
  cached_public_hits INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
