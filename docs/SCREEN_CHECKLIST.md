# SCREEN CHECKLIST — Phase 0 (and current build status)

Legend: **COMPLETE** = real data, persisted in D1, buttons work; **PARTIAL** = works but narrowed; **INCOMPLETE** = not built / not verified.
Live machine-readable version: `GET /api/v1/features` → `/erp/status`. See `docs/FEATURE_CHECKLIST.md` for the full table with evidence.

## Every screen must show these states

| State | Implementation |
|---|---|
| Loading | `Skeleton` / `AsyncView` with `aria-busy` |
| Empty | `EmptyState` with a real empty message (no fake rows) |
| Validation | Zod server errors + inline `⚠` `aria-invalid`, disabled submit |
| Server error + retry | `ErrorState` with «دوبارہ کوشش» calling `refetch()` |
| Offline | `OfflineBanner` + Dexie outbox + PROVISIONAL numbering |
| Permission denied | `AsyncView permission` + `requirePerm()` on the Worker (H5) |
| A11y | semantic labels, `aria-*`, keyboard Escape/focus, RTL logical properties |
| 360 / 390 / 768 / 1280 | responsive CSS; **44 real Chromium baselines, 2nd run 0 % diff** (`docs/VISUAL_REPORT.md`) |

## PUB-01…09

| ID | Screen | State |
|---|---|---|
| PUB-01 | Home | COMPLETE |
| PUB-02 | Products / category | COMPLETE |
| PUB-03 | Product card | COMPLETE |
| PUB-04 | Product detail | COMPLETE |
| PUB-05 | Enquiry | COMPLETE |
| PUB-06 | About | PARTIAL (owner review before publish) |
| PUB-07 | Contact | COMPLETE |
| PUB-08 | Privacy / terms | PARTIAL (legal copy needs owner review) |
| PUB-09 | 404 / sitemap / robots | COMPLETE |

## ERP-01…38

| ID | Screen | State | ID | Screen | State |
|---|---|---|---|---|---|
| ERP-01 | Setup wizard | COMPLETE | ERP-20 | Khata centre | COMPLETE |
| ERP-02 | Login | PARTIAL (passkeys only) | ERP-21 | Receipts / payments | PARTIAL |
| ERP-03 | Dashboard | COMPLETE | ERP-22 | Money accounts | COMPLETE |
| ERP-04 | Quick entry | PARTIAL | ERP-23 | Transfers | COMPLETE |
| ERP-05 | Products list | COMPLETE | ERP-24 | Returns | PARTIAL |
| ERP-06 | Product form | PARTIAL | ERP-25 | Expenses | COMPLETE |
| ERP-07 | CSV import | COMPLETE | ERP-26 | Employees / payroll | PARTIAL |
| ERP-08 | Catalogue admin | PARTIAL | ERP-27 | Inventory | COMPLETE |
| ERP-09 | Fertilizer hub | COMPLETE | ERP-28 | Website CMS | PARTIAL |
| ERP-10 | Fertilizer purchase | COMPLETE | ERP-29 | Enquiries inbox | PARTIAL |
| ERP-11 | Fertilizer sale | COMPLETE | ERP-30 | Documents centre | PARTIAL |
| ERP-12 | Pesticide module | PARTIAL | ERP-31 | Reports gallery | PARTIAL |
| ERP-13 | Five goods modules | COMPLETE | ERP-32 | Accounting | COMPLETE |
| ERP-14 | Grains hub | COMPLETE | ERP-33 | Users / roles | PARTIAL |
| ERP-15 | Crop page | COMPLETE | ERP-34 | Sync centre | COMPLETE |
| ERP-16 | Grain purchase | COMPLETE | ERP-35 | Backup | PARTIAL |
| ERP-17 | Grain sale | COMPLETE | ERP-36 | Settings | COMPLETE |
| ERP-18 | Parties | PARTIAL | ERP-37 | Audit log | COMPLETE |
| ERP-19 | Party khata | COMPLETE | ERP-38 | 403/404/offline states | PARTIAL |

## Cross-cutting

| ID | Item | State |
|---|---|---|
| P8-OFFLINE | PWA / Dexie outbox / 4 sync triggers | COMPLETE |
| P8-PIN | PIN-derived AES-GCM cache encryption | COMPLETE (4 unit tests + browser E2E, 4/4 encrypted IndexedDB rows) |
| P8-PASSKEYS | WebAuthn passkeys | COMPLETE (`A15_E2E_PASS`; real phone untested) |
| P8-TURNSTILE | Turnstile | PARTIAL (server siteverify gate + local tests; real CF unverified) |
| P8-R2 | Private R2 | PARTIAL (local uploads work; production binding not configured) |
| P8-CACHE-PURGE | Edge cache purge | COMPLETE (generation + known-key delete; live edge unverified) |
| P9-QUERY-PLAN | EXPLAIN QUERY PLAN CI gate | COMPLETE (15/15) |
| P9-VISUAL | Playwright visual regression | COMPLETE (44 baselines / 0 % drift) |
| P9-LIGHTHOUSE | Lighthouse | COMPLETE (100/100/100 on 3 pages) |
| P9-A11Y | a11y / 360–1280 | COMPLETE (axe-core 0 violations on 8 pages) |
| P11-DOCS | docs / CSV / OpenAPI | COMPLETE |
| P12-RESTORE | staging restore test | PARTIAL (local staging-equivalent PASSED; Cloudflare staging not run) |
| P9-PRINT | Urdu print / PDF proof | COMPLETE (desktop + Android-emulated; physical device INCOMPLETE) |
| P9-QUOTA | A19 quota/cache guard | COMPLETE (200 hits: rows_read=1, cached_hits=199) |
| P9-ROUTES | A20 route matrix | COMPLETE (29 CSRF, 24 AUDITOR writes, IDOR/SQLi/XSS) |
| P12-NEW-PROJECT | New project config | COMPLETE (`wrangler.v2.jsonc` dry-runs exit 0 + real staging/production deploy) |
| P12-DEPLOY | Cloudflare deployment | **COMPLETE** — `https://zt-v2.sastishopping-store.workers.dev` / `https://zt-v2-staging.sastishopping-store.workers.dev` (R2 buckets + custom domain pending) |
