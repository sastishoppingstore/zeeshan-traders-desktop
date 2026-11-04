# CSV templates

Empty header-only files on purpose — **the production catalogue starts EMPTY** and no sample/fake
business row is shipped. Download a template from the app too (`/erp/products/import`).

| File | Import path | Notes |
|---|---|---|
| `products.csv` | `/erp/products/import` → preview → confirm | `category_code` must match a category code or slug (FERT, PEST, CHOK, WAND, CEM, SEED, OTHR, WHEAT…); `purchase_rate`/`sale_rate` are **rupees** and are converted to integer paisa; `conversion_ratio` uses milli-units (1000 = 1:1). Preview never writes; confirm is one atomic `db.batch()`. Duplicate SKU/name → SKIP or UPDATE. |
| `parties.csv` | owner entry via `/erp/parties/new` (bulk party import INCOMPLETE) | `opening_balance` rupees, `opening_direction` = RECEIVABLE/PAYABLE; balances must balance against the trial balance. |
| `opening-stock.csv` | `/erp/inventory` → «اوپننگ» (single row UI; bulk import INCOMPLETE) | `qty_base_units` in declared base units, `unit_cost` rupees. |
| `grain-rate.csv` | settings / product rate (bulk import INCOMPLETE) | `rate_basis` = PER_MAUND or PER_KG. Per-maund rates are blocked until `maund_kg` + `maund_confirmed` are set by the owner. |

All files are UTF-8 with BOM-friendly headers; Urdu names are supported. Never invent prices, stock,
balances, licence numbers or opening balances — the owner supplies them.
