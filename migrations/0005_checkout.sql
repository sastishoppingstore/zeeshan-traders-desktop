-- 0005 — Website checkout: orders, payment proofs, admin payment methods, media fallback.
-- Orders are NOT sales. A sale + receipt is created only when an admin approves an order,
-- and it goes through the existing posting engines (stock, ledger, journal all stay balanced).

-- Media fallback: R2 is not bound on every environment, so small images can live in D1.
CREATE TABLE IF NOT EXISTS media_blobs (
  key TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Admin-maintained payment instructions shown at checkout (bank account, QR code, wallets).
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('BANK','EASYPAISA','JAZZCASH','WALLET','CASH')),
  title_ur TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_title TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  iban TEXT NOT NULL DEFAULT '',
  mobile_number TEXT NOT NULL DEFAULT '',
  instructions_ur TEXT NOT NULL DEFAULT '',
  qr_key TEXT NOT NULL DEFAULT '',
  account_id TEXT REFERENCES financial_accounts(id),  -- ledger account the money lands in on approval
  is_active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_active ON payment_methods(is_active, sort);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  access_token_hash TEXT NOT NULL,          -- sha256 of the token handed to the customer
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  payment_method_id TEXT REFERENCES payment_methods(id),
  payment_method_snapshot TEXT NOT NULL DEFAULT '',  -- survives later edits to the method
  total_paisa INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','UNDER_REVIEW','APPROVED','REJECTED','CANCELLED')),
  reject_reason TEXT NOT NULL DEFAULT '',
  party_id TEXT REFERENCES parties(id),
  sale_ids TEXT NOT NULL DEFAULT '[]',     -- one posted sale per book the cart touched
  ordered_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_mobile ON orders(mobile);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT REFERENCES products(id),
  name_ur TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  qty_milli INTEGER NOT NULL DEFAULT 0,
  rate_paisa INTEGER NOT NULL DEFAULT 0,
  line_total_paisa INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL DEFAULT '',
  sender_reference TEXT NOT NULL DEFAULT '',
  amount_paisa INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  media_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ACCEPTED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS idx_proofs_order ON payment_proofs(order_id, uploaded_at);

-- ------------------------------ New permissions ------------------------------
INSERT OR IGNORE INTO permissions (code,description_ur) VALUES ('orders.read','آن لائن آرڈر پڑھنا');
INSERT OR IGNORE INTO permissions (code,description_ur) VALUES ('orders.review','آن لائن آرڈر منظور یا مسترد کرنا');
INSERT OR IGNORE INTO permissions (code,description_ur) VALUES ('payments.methods.write','ادائیگی کے طریقے بنانا / بدلتا');

INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-owner','orders.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-owner','orders.review');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-owner','payments.methods.write');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-manager','orders.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-manager','orders.review');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-accountant','orders.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-salesperson','orders.read');

-- "Worker" — a shop hand who can raise invoices and take payments but changes nothing else.
INSERT OR IGNORE INTO roles (id,code,name_ur,name_en,is_system) VALUES ('role-worker','WORKER','ورکر','Shop worker',1);
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','auth.login');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','dashboard.view');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','products.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','parties.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','parties.write');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','sales.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','sales.post');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','receipts.post');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','stock.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','khata.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','documents.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','documents.print');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','orders.read');
INSERT OR IGNORE INTO role_permissions (role_id,permission_code) VALUES ('role-worker','sync.read');

-- Invoice prefix for orders (document numbering stays in invoice_sequences).
INSERT OR IGNORE INTO invoice_sequences (code,prefix,next_value,updated_at) VALUES ('ORDER','OD',1,'2026-01-01T00:00:00.000Z');
