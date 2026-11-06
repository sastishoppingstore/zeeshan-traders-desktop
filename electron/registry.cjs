/**
 * Offline-sync registry — GENERATED, DO NOT EDIT BY HAND.
 *
 *   source    packages/shared/src/sync.ts   (sha256 19c354cccb8aad3f)
 *   generator electron/gen-registry.cjs     (re-run it after editing the TS registry)
 *   gate      electron/verify-registry.cjs  (exits non-zero if this mirror drifts)
 *
 * packages/shared/src/sync.ts is the single source of truth for the whole repo. This file exists
 * only because Electron's main process must be plain CommonJS with no bundler step, so the same
 * data is emitted here in a form the main process can require() without Node's TS type stripping.
 * Keep the tier rules in the TS file; change nothing about them here.
 */
'use strict';

const SOURCE = {
  "file": "packages/shared/src/sync.ts",
  "sha256": "19c354cccb8aad3f",
  "generated_by": "electron/gen-registry.cjs"
};

/** row tier — master data, bidirectional, optimistic-locked by `version`. */
const ROW_ENTITIES = [
  {
    "tier": "row",
    "entity": "products",
    "table": "products",
    "pk": "id",
    "readPerm": "products.read",
    "writePerm": "products.write",
    "required": [
      "name_ur",
      "category_id",
      "base_unit",
      "purchase_unit",
      "sale_unit"
    ],
    "derive_slug": true,
    "has_created_at": true,
    "has_created_by": true,
    "columns": [
      "name_ur",
      "name_en",
      "category_id",
      "brand_id",
      "sku",
      "barcode",
      "description_ur",
      "description_en",
      "base_unit",
      "purchase_unit",
      "sale_unit",
      "conversion_ratio_milli",
      "grams_per_base_unit",
      "track_batch",
      "track_expiry",
      "is_pesticide",
      "reorder_level_milli",
      "purchase_rate_paisa",
      "sale_rate_paisa",
      "tax_pct_milli",
      "show_public_price",
      "public_price_paisa",
      "availability_mode",
      "is_published",
      "is_featured",
      "is_active",
      "seo_title",
      "seo_description",
      "season"
    ]
  },
  {
    "tier": "row",
    "entity": "categories",
    "table": "product_categories",
    "pk": "id",
    "readPerm": "catalogue.read",
    "writePerm": "catalogue.write",
    "required": [
      "code",
      "name_ur"
    ],
    "derive_slug": true,
    "has_created_at": true,
    "has_created_by": true,
    "columns": [
      "code",
      "parent_id",
      "name_ur",
      "name_en",
      "icon",
      "sort",
      "is_active"
    ]
  },
  {
    "tier": "row",
    "entity": "brands",
    "table": "brands",
    "pk": "id",
    "readPerm": "catalogue.read",
    "writePerm": "catalogue.write",
    "required": [
      "name_ur"
    ],
    "has_created_at": true,
    "has_created_by": false,
    "columns": [
      "name_ur",
      "name_en",
      "is_active"
    ]
  },
  {
    "tier": "row",
    "entity": "parties",
    "table": "parties",
    "pk": "id",
    "readPerm": "parties.read",
    "writePerm": "parties.write",
    "required": [
      "name_ur",
      "type"
    ],
    "has_created_at": true,
    "has_created_by": true,
    "columns": [
      "name_ur",
      "name_en",
      "phone",
      "village",
      "type",
      "credit_limit_paisa",
      "notes",
      "is_active"
    ]
  },
  {
    "tier": "row",
    "entity": "employees",
    "table": "employees",
    "pk": "id",
    "readPerm": "employees.read",
    "writePerm": "employees.write",
    "required": [
      "name",
      "join_date"
    ],
    "has_created_at": true,
    "has_created_by": false,
    "columns": [
      "name",
      "role",
      "phone",
      "join_date",
      "base_salary_paisa",
      "status"
    ]
  },
  {
    "tier": "row",
    "entity": "warehouses",
    "table": "warehouses",
    "pk": "id",
    "readPerm": "stock.read",
    "writePerm": "stock.adjust",
    "required": [
      "code",
      "name_ur"
    ],
    "has_created_at": false,
    "has_created_by": false,
    "columns": [
      "code",
      "name_ur",
      "is_default"
    ]
  },
  {
    "tier": "row",
    "entity": "product_units",
    "table": "product_units",
    "pk": "id",
    "readPerm": "products.read",
    "writePerm": "products.write",
    "required": [
      "product_id",
      "unit_code",
      "ratio_milli"
    ],
    "has_created_at": false,
    "has_created_by": false,
    "columns": [
      "product_id",
      "unit_code",
      "ratio_milli",
      "is_base"
    ]
  },
  {
    "tier": "row",
    "entity": "unit_conversions",
    "table": "unit_conversions",
    "pk": "id",
    "readPerm": "products.read",
    "writePerm": "products.write",
    "required": [
      "from_unit",
      "to_unit",
      "ratio_milli"
    ],
    "has_created_at": true,
    "has_created_by": false,
    "columns": [
      "from_unit",
      "to_unit",
      "ratio_milli",
      "confirmed"
    ]
  },
  {
    "tier": "row",
    "entity": "expense_categories",
    "table": "expense_categories",
    "pk": "id",
    "readPerm": "expenses.read",
    "writePerm": "expenses.post",
    "required": [
      "code",
      "name_ur",
      "name_en",
      "group_code",
      "gl_code"
    ],
    "has_created_at": false,
    "has_created_by": false,
    "columns": [
      "code",
      "name_ur",
      "name_en",
      "group_code",
      "gl_code"
    ]
  },
  {
    "tier": "row",
    "entity": "financial_accounts",
    "table": "financial_accounts",
    "pk": "id",
    "readPerm": "accounts.read",
    "writePerm": "accounts.write",
    "required": [
      "code",
      "name_ur",
      "name_en",
      "type",
      "gl_code"
    ],
    "has_created_at": false,
    "has_created_by": false,
    "columns": [
      "code",
      "name_ur",
      "name_en",
      "type",
      "gl_code",
      "opening_date",
      "is_active"
    ]
  },
  {
    "tier": "row",
    "entity": "chart_of_accounts",
    "table": "chart_of_accounts",
    "pk": "code",
    "readPerm": "accounting.read",
    "writePerm": "accounts.write",
    "required": [
      "name_ur",
      "name_en",
      "type"
    ],
    "has_created_at": false,
    "has_created_by": false,
    "columns": [
      "name_ur",
      "name_en",
      "type",
      "parent_code",
      "is_active"
    ]
  },
  {
    "tier": "row",
    "entity": "payment_methods",
    "table": "payment_methods",
    "pk": "id",
    "readPerm": "khata.read",
    "writePerm": "payments.methods.write",
    "required": [
      "kind",
      "title_ur"
    ],
    "has_created_at": true,
    "has_created_by": false,
    "columns": [
      "kind",
      "title_ur",
      "title_en",
      "bank_name",
      "account_title",
      "account_number",
      "iban",
      "mobile_number",
      "instructions_ur",
      "sort",
      "is_active"
    ]
  },
  {
    "tier": "row",
    "entity": "product_batches",
    "table": "product_batches",
    "pk": "id",
    "readPerm": "stock.read",
    "writePerm": "stock.adjust",
    "required": [
      "product_id",
      "batch_no"
    ],
    "has_created_at": true,
    "has_created_by": false,
    "columns": [
      "product_id",
      "batch_no",
      "mfg_date",
      "expiry_date",
      "manufacturer",
      "active_ingredient",
      "quarantined"
    ]
  },
  {
    "tier": "row",
    "entity": "settings",
    "table": "business_settings",
    "pk": "key",
    "readPerm": "settings.read",
    "writePerm": "settings.write",
    "required": [
      "value"
    ],
    "has_created_at": false,
    "has_created_by": false,
    "columns": [
      "value"
    ]
  }
];

/** command tier — financial documents: the client sends an INTENT, the server posts the ledger. */
const COMMAND_ENTITIES = [
  {
    "tier": "command",
    "entity": "sale",
    "table": "sales",
    "pk": "id",
    "opType": "SALE",
    "readPerm": "sales.read",
    "writePerm": "sales.post"
  },
  {
    "tier": "command",
    "entity": "purchase",
    "table": "purchases",
    "pk": "id",
    "opType": "PURCHASE",
    "readPerm": "purchases.read",
    "writePerm": "purchases.post"
  },
  {
    "tier": "command",
    "entity": "receipt",
    "table": "receipts",
    "pk": "id",
    "opType": "RECEIPT",
    "readPerm": "khata.read",
    "writePerm": "receipts.post"
  },
  {
    "tier": "command",
    "entity": "payment",
    "table": "payments",
    "pk": "id",
    "opType": "PAYMENT",
    "readPerm": "khata.read",
    "writePerm": "payments.post"
  },
  {
    "tier": "command",
    "entity": "expense",
    "table": "expenses",
    "pk": "id",
    "opType": "EXPENSE",
    "readPerm": "expenses.read",
    "writePerm": "expenses.post"
  },
  {
    "tier": "command",
    "entity": "grain_purchase",
    "table": "grain_weighments",
    "pk": "id",
    "opType": "GRAIN_PURCHASE",
    "readPerm": "grains.read",
    "writePerm": "grains.post"
  },
  {
    "tier": "command",
    "entity": "grain_sale",
    "table": "grain_weighments",
    "pk": "id",
    "opType": "GRAIN_SALE",
    "readPerm": "grains.read",
    "writePerm": "grains.post"
  },
  {
    "tier": "command",
    "entity": "party",
    "table": "parties",
    "pk": "id",
    "opType": "PARTY",
    "readPerm": "parties.read",
    "writePerm": "parties.write"
  }
];

/** replica tier — server-derived, pull-only. A client write for these is never accepted. */
const REPLICA_ENTITIES = [
  {
    "entity": "sales",
    "table": "sales",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "sales.read"
  },
  {
    "entity": "sale_items",
    "table": "sale_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "sales.read"
  },
  {
    "entity": "purchases",
    "table": "purchases",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "purchases.read"
  },
  {
    "entity": "purchase_items",
    "table": "purchase_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "purchases.read"
  },
  {
    "entity": "receipts",
    "table": "receipts",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "khata.read"
  },
  {
    "entity": "payments",
    "table": "payments",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "khata.read"
  },
  {
    "entity": "expenses",
    "table": "expenses",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "expenses.read"
  },
  {
    "entity": "sales_returns",
    "table": "sales_returns",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "returns.read"
  },
  {
    "entity": "sale_return_items",
    "table": "sale_return_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "returns.read"
  },
  {
    "entity": "purchase_returns",
    "table": "purchase_returns",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "returns.read"
  },
  {
    "entity": "purchase_return_items",
    "table": "purchase_return_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "returns.read"
  },
  {
    "entity": "grain_weighments",
    "table": "grain_weighments",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "grains.read"
  },
  {
    "entity": "grain_deductions",
    "table": "grain_deductions",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "grains.read"
  },
  {
    "entity": "grain_lots",
    "table": "grain_lots",
    "tier": "replica",
    "pk": "id",
    "cursor": "opened_at",
    "readPerm": "grains.read"
  },
  {
    "entity": "stock_adjustments",
    "table": "stock_adjustments",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "stock.read"
  },
  {
    "entity": "stock_counts",
    "table": "stock_counts",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "stock.read"
  },
  {
    "entity": "stock_count_lines",
    "table": "stock_count_lines",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "stock.read"
  },
  {
    "entity": "stock_movements",
    "table": "stock_movements",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "stock.read"
  },
  {
    "entity": "stock_openings",
    "table": "stock_openings",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "stock.read"
  },
  {
    "entity": "transfers",
    "table": "transfers",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "accounts.read"
  },
  {
    "entity": "quotations",
    "table": "quotations",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "orders.read"
  },
  {
    "entity": "quotation_items",
    "table": "quotation_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "orders.read"
  },
  {
    "entity": "orders",
    "table": "orders",
    "tier": "replica",
    "pk": "id",
    "cursor": "ordered_at",
    "readPerm": "orders.read"
  },
  {
    "entity": "order_items",
    "table": "order_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "orders.read"
  },
  {
    "entity": "payment_allocations",
    "table": "payment_allocations",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "khata.read"
  },
  {
    "entity": "payment_proofs",
    "table": "payment_proofs",
    "tier": "replica",
    "pk": "id",
    "cursor": "uploaded_at",
    "readPerm": "khata.read"
  },
  {
    "entity": "employee_advances",
    "table": "employee_advances",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "employees.read"
  },
  {
    "entity": "salary_records",
    "table": "salary_records",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "employees.read"
  },
  {
    "entity": "salary_payments",
    "table": "salary_payments",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "employees.read"
  },
  {
    "entity": "party_ledger",
    "table": "party_ledger",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "khata.read"
  },
  {
    "entity": "party_opening_balances",
    "table": "party_opening_balances",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "khata.read"
  },
  {
    "entity": "account_transactions",
    "table": "account_transactions",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "accounts.read"
  },
  {
    "entity": "account_reconciliations",
    "table": "account_reconciliations",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "accounts.read"
  },
  {
    "entity": "journal_entries",
    "table": "journal_entries",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "accounting.read"
  },
  {
    "entity": "journal_lines",
    "table": "journal_lines",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "accounting.read"
  },
  {
    "entity": "documents",
    "table": "documents",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "documents.read"
  },
  {
    "entity": "file_attachments",
    "table": "file_attachments",
    "tier": "replica",
    "pk": "id",
    "cursor": "uploaded_at",
    "readPerm": "documents.read"
  },
  {
    "entity": "audit_logs",
    "table": "audit_logs",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "audit.read"
  },
  {
    "entity": "website_pages",
    "table": "website_pages",
    "tier": "replica",
    "pk": "id",
    "cursor": "updated_at",
    "readPerm": "cms.read"
  },
  {
    "entity": "website_banners",
    "table": "website_banners",
    "tier": "replica",
    "pk": "id",
    "cursor": "updated_at",
    "readPerm": "cms.read"
  },
  {
    "entity": "website_announcements",
    "table": "website_announcements",
    "tier": "replica",
    "pk": "id",
    "cursor": "updated_at",
    "readPerm": "cms.read"
  },
  {
    "entity": "website_enquiries",
    "table": "website_enquiries",
    "tier": "replica",
    "pk": "id",
    "cursor": "updated_at",
    "readPerm": "orders.read"
  },
  {
    "entity": "website_enquiry_items",
    "table": "website_enquiry_items",
    "tier": "replica",
    "pk": "id",
    "cursor": "id",
    "readPerm": "orders.read"
  },
  {
    "entity": "users",
    "table": "users",
    "tier": "replica",
    "pk": "id",
    "cursor": "updated_at",
    "readPerm": "users.read"
  },
  {
    "entity": "sessions",
    "table": "sessions",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "users.read"
  },
  {
    "entity": "devices",
    "table": "devices",
    "tier": "replica",
    "pk": "id",
    "cursor": "registered_at",
    "readPerm": "users.read"
  },
  {
    "entity": "sync_operations",
    "table": "sync_operations",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "sync.read"
  },
  {
    "entity": "sync_conflicts",
    "table": "sync_conflicts",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "sync.read"
  },
  {
    "entity": "product_images",
    "table": "product_images",
    "tier": "replica",
    "pk": "id",
    "cursor": "created_at",
    "readPerm": "products.read"
  },
  {
    "entity": "stock_balance",
    "table": "stock_balance",
    "tier": "replica",
    "pk": "product_id",
    "pk_cols": [
      "product_id",
      "warehouse_id"
    ],
    "cursor": "updated_at",
    "full_refresh": true,
    "readPerm": "stock.read"
  },
  {
    "entity": "stock_batch_balance",
    "table": "stock_batch_balance",
    "tier": "replica",
    "pk": "batch_id",
    "pk_cols": [
      "batch_id",
      "warehouse_id"
    ],
    "cursor": "updated_at",
    "full_refresh": true,
    "readPerm": "stock.read"
  },
  {
    "entity": "party_balance",
    "table": "party_balance",
    "tier": "replica",
    "pk": "party_id",
    "cursor": "updated_at",
    "full_refresh": true,
    "readPerm": "khata.read"
  },
  {
    "entity": "account_balance",
    "table": "account_balance",
    "tier": "replica",
    "pk": "account_id",
    "cursor": "updated_at",
    "full_refresh": true,
    "readPerm": "accounts.read"
  },
  {
    "entity": "daily_summary",
    "table": "daily_summary",
    "tier": "replica",
    "pk": "date",
    "pk_cols": [
      "date",
      "book_code",
      "metric"
    ],
    "cursor": "updated_at",
    "full_refresh": true,
    "readPerm": "reports.view"
  },
  {
    "entity": "invoice_sequences",
    "table": "invoice_sequences",
    "tier": "replica",
    "pk": "code",
    "cursor": "updated_at",
    "full_refresh": true,
    "readPerm": "documents.read"
  }
];

const ALL_ENTITIES = [...ROW_ENTITIES, ...COMMAND_ENTITIES, ...REPLICA_ENTITIES];

const BY_NAME = new Map(ALL_ENTITIES.map((e) => [e.entity, e]));
const BY_TABLE = new Map(ALL_ENTITIES.map((e) => [e.tier + ':' + e.table, e]));

const entityOf = (name) => BY_NAME.get(name);
const rowEntity = (name) => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'row' ? e : undefined;
};
const commandEntity = (name) => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'command' ? e : undefined;
};
const commandEntityByOpType = (opType) => COMMAND_ENTITIES.find((e) => e.opType === opType);
const replicaEntity = (name) => {
  const e = BY_NAME.get(name);
  return e && e.tier === 'replica' ? e : undefined;
};
const replicaByTable = (table) => REPLICA_ENTITIES.find((e) => e.table === table);

/** Table names owned by the sync layer — used to prove no table was forgotten. */
const SYNCED_TABLES = new Set(ALL_ENTITIES.map((e) => e.table));

/** Every table that the desktop mirrors locally and therefore needs the `synced` column. */
const LOCAL_TRACKED_TABLES = [...new Set(
  [...ROW_ENTITIES, ...REPLICA_ENTITIES].map((e) => e.table),
)];

/**
 * Clamp a client-supplied column bag to the entity whitelist and SQLite-safe scalars.
 * Mirrors sanitizeRowData() in packages/shared/src/sync.ts — verify-registry.cjs diffs the two
 * implementations against shared fixtures rather than trusting this comment.
 */
function sanitizeRowData(def, raw) {
  const src = raw ?? {};
  const out = {};
  for (const col of def.columns) {
    const value = src[col];
    if (value === undefined) continue;
    if (value === null) { out[col] = null; continue; }
    if (typeof value === 'boolean') out[col] = value ? 1 : 0;
    else if (typeof value === 'string' || typeof value === 'number') out[col] = value;
    // Objects/arrays are never legitimate column values in this schema: drop them.
  }
  return out;
}

/**
 * Which entity name should a *read* of this table go through? `sales` is both a command entity and
 * a replica entity; reads must use the replica definition (cursor + tier), writes must not use it
 * at all. The registry is the only place that decides this.
 */
function readableFor(name) {
  return replicaEntity(name) ?? rowEntity(name) ?? commandEntity(name);
}

function writableForRow(name) {
  return rowEntity(name);
}

module.exports = {
  SOURCE,
  ROW_ENTITIES,
  COMMAND_ENTITIES,
  REPLICA_ENTITIES,
  ALL_ENTITIES,
  SYNCED_TABLES,
  LOCAL_TRACKED_TABLES,
  entityOf,
  rowEntity,
  commandEntity,
  commandEntityByOpType,
  replicaEntity,
  replicaByTable,
  readableFor,
  writableForRow,
  sanitizeRowData,
};
