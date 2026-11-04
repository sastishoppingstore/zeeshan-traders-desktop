# ROUTE MAP — Phase 0

One host, one Hono Worker, one D1 database. Browser code uses **relative URLs** only (never localhost), so the same build works behind the Arena preview proxy and on Cloudflare.

## Public website (PUB-01…09)

| Route | Screen | Data |
|---|---|---|
| `/` | PUB-01 Home | `/api/v1/public/home` (cached 180 s) |
| `/products`, `/category/:slug` | PUB-02 catalogue + filters + keyset pagination | `/api/v1/public/products`, `/api/v1/public/categories` |
| (component) | PUB-03 product card | whitelist from `publicProduct()` |
| `/product/:slug` | PUB-04 detail, gallery, WhatsApp CTA, JSON-LD | `/api/v1/public/product/:slug` |
| `/enquiry` | PUB-05 enquiry (honeypot, time trap, consent, rate limit) | `POST /api/v1/public/enquiry` |
| `/about`, `/contact`, `/privacy`, `/terms` | PUB-06…08 | `/api/v1/public/pages/:slug` (PUBLISHED only) |
| `*` | PUB-09 404 | SPA fallback; Worker serves 404 for unknown `/api/*` |
| `/sitemap.xml`, `/robots.txt` | PUB-09 SEO | generated from published rows |
| `/manifest.webmanifest`, `/sw.js`, `/fonts/*`, `/icons/*` | PWA | self-hosted, offline-capable |

## Private ERP (ERP-01…38)

| Route | ID | Notes |
|---|---|---|
| `/erp/setup` | ERP-01 | 7-step wizard, one-time token, maund confirmation |
| `/erp/login` | ERP-02 | PBKDF2 password login; passkey INCOMPLETE badge |
| `/erp` | ERP-03 | dashboard (pre-aggregated `daily_summary`/balances) |
| quick sheet (FAB) + `?quick=1` | ERP-04 | name, qty, amount, cash/credit |
| `/erp/products`, `/new`, `/:id`, `/import` | ERP-05…07 | list, 5-tab form, CSV preview→confirm |
| `/erp/catalogue/:kind` | ERP-08 | categories / brands / unit conversions |
| `/erp/fertilizer`, `/purchase/new`, `/sale/new` | ERP-09…11 | FERT book |
| `/erp/pesticide`, `/purchase/new`, `/sale/new` | ERP-12 | PEST book, mandatory buyer/batch/expiry, register tab |
| `/erp/goods/:book`, `/purchase/new`, `/sale/new` | ERP-13 | CHOK, WAND, CEM, SEED, OTHR |
| `/erp/grains`, `/erp/grains/:crop`, `/purchase/new`, `/sale/new` | ERP-14…17 | 7 crop modules, net-weight arithmetic, lot reconciliation |
| `/erp/parties`, `/new`, `/:id` | ERP-18…19 | party list, new party, party khata |
| `/erp/khata` | ERP-20 | all books, ageing, ledger, printable statement |
| `/erp/receipts/new`, `/erp/payments/new` | ERP-21 | AUTO / MANUAL / ADVANCE allocation |
| `/erp/accounts`, `/:id`, `/transfer` | ERP-22…23 | 4 money books, transfers, fees |
| `/erp/returns` | ERP-24 | reversal + replacement, never edit posted |
| `/erp/expenses`, `/new` | ERP-25 | general + shop expenses |
| `/erp/employees`, `/new`, `/payroll/:ym` | ERP-26 | employees, advances, payroll run |
| `/erp/inventory` | ERP-27 | stock, ledger, batches/FEFO, opening, adjustment, physical count |
| `/erp/website` | ERP-28 | CMS pages, announcements, publish/cache purge |
| `/erp/enquiries` | ERP-29 | approve/reject/quotation/WhatsApp reply |
| `/erp/documents` | ERP-30 | all posted docs, JSON snapshot, browser print |
| `/erp/reports?report=…` | ERP-31 | 12 report gallery entries |
| `/erp/accounting` | ERP-32 | COA, journals, manual balanced journal, period lock, integrity |
| `/erp/users` | ERP-33 | users, roles matrix, device revoke |
| `/erp/sync` | ERP-34 | local outbox, server ops, conflicts |
| `/erp/backup` | ERP-35 | run encrypted backup, logs, download |
| `/erp/settings` | ERP-36 | 30 settings, business facts, owner inputs |
| `/erp/audit` | ERP-37 | audit trail |
| `/erp/status` | ERP-38 + checklist | live `/api/v1/features` with COMPLETE/PARTIAL/INCOMPLETE |
| `/erp/more`, `*` | — | mobile nav, 404 |

## API surface (`/api/v1/*`)

**Public (no auth):** `/public/home`, `/public/categories`, `/public/products`, `/public/product/:slug`, `/public/pages/:slug`, `POST /public/enquiry`, `/setup/status`, `POST /setup`, `POST /auth/login`, `/health`, `/features`.

**Authenticated, deny-by-default (`requirePerm`) groups:**
* auth/users: `/auth/me`, `/auth/logout`, `/roles`, `/users`, `/users/:id/disable`, `/users/:id/reset-password`, `/devices`, `/devices/:id/revoke`
* catalogue: `/products`, `/products/:id`, `/products/:id/publish`, `/products/bulk`, `/catalogue/export`, `/import/products/preview`, `/import/products/confirm`, `/categories`, `/brands`, `/units`, `/images`, `/media/:key`
* transactions: `/purchases`, `/sales`, `/returns`, `/grains/:crop/purchase|sale`, `/grains/lots`, `/grains/summary`, `/parties`, `/receipts`, `/payments`, `/accounts`, `/transfers`, `/jazzcash`, `/reconcile`, `/expenses`, `/expense-categories`, `/employees`, `/advances`, `/payroll`, `/stock*`, `/accounting/journal`, `/accounting/period-close`
* reports: `/dashboard`, `/khata*`, `/statements`, `/reports/*` (trial-balance, pnl, balance-sheet, daybook, cashbook, stock, expiry, pesticide-register, fertilizer-register, reconcile), `/documents`, `/documents/:id`, `/accounting/chart`, `/accounting/journals`, `/audit`, `/integrity`, `/integrity/run`
* ops: `/settings`, `/usage`, `/sync/*`, `/backup*`, `/ops/jobs`, `/features`
* website: `/website/pages`, `/website/banners`, `/website/announcements`, `/website/publish`, `/enquiries*`

Full contracts: `docs/OPENAPI.yaml`.
