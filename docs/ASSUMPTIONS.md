# ASSUMPTIONS / مفروضات — Phase 0

Recorded 2026-11-03. Anything requiring owner confirmation is flagged **NEEDS OWNER INPUT** and never guessed in code.

## Defaults used (from the master prompt, not invented)

* Business profile: ذیشان ٹریڈرز / Zeeshan Traders; مقصود چوک، ضلع لیہ، پنجاب، پاکستان; `0307-7864722`, `0345-4654722`; `https://wa.me/923077864722`, `https://wa.me/923454654722`; PKR, Asia/Karachi, `en-PK` grouping, fiscal year July–June, week starts Saturday, Urdu RTL default.
* No email, opening hours, reviews, ratings, prices, stock, balances, tax/licence numbers or opening balances. Production catalogue starts **EMPTY**.
* 17 ledgers: FERT, PEST, CHOK, WAND, CEM, SEED, OTHR; WHEAT, RICE, SESAME, MILLET, MAIZE, MOONG, MUSTARD; plus CASH, JAZZ, MEEZAN, UBL money books and receivable/payable/expense/advance GL accounts.
* Money = integer paisa; quantity = integer milli-units of the product's declared base unit. Grain gross/tare/net are integer grams, therefore identical to milli-kg.
* Document numbering: `FS-YYYY-000001` (purchases/sales), `RC-`, `PV-`, `EX-`, `SL-`, `QT-`, `EQ-`; prefixes editable in settings.
* `template_version = zt-print-1.0`; JSON snapshot saved with every document.

## NEEDS OWNER INPUT — blocking for production, never guessed

| # | Item | Why it matters | Where it is entered |
|---|---|---|---|
| 1 | **1 من = ? kg** | per-maund grain rates are hard-blocked until confirmed | Setup wizard step 3 / `/erp/settings` (`maund_kg`, `maund_confirmed`) |
| 2 | Bag sizes / unit conversions | no silent 50 kg assumption | Product form (base/purchase/sale unit + conversion ratio), `/erp/catalogue/units` |
| 3 | Pesticide & fertiliser licence numbers + expiry | legal register/print header; never fabricated | Setup step 6 / settings |
| 4 | Opening balances (cash, bank, parties, stock) | trial balance must balance | Setup step 4, `/erp/inventory` opening, `/api/v1/accounting/journal` |
| 5 | Domain name | CSP/HSTS, sitemap, canonical URLs; WebAuthn RP ID is domain-bound | `wrangler.v2.jsonc` `RP_ID` / `RP_ORIGIN` (deferred by owner) |
| 6 | Cloudflare account access / new D1 UUID / new R2 bucket | deployment | `wrangler.v2.jsonc` placeholders; see `docs/NEW_PROJECT_DEPLOY.md` |
| 7 | Current Punjab pesticide/fertiliser rules & retention period | legal compliance | owner confirms with District Agriculture Office, Layyah; `record_retention_years` setting (default 3, unverified) |
| 8 | Optional CNIC collection switch & privacy copy | sensitive field | `cnic_enabled`, `privacy_cnic` settings; legal text needs owner review |
| 9 | Owner mock-ups / «pixel-perfect» reference | words cannot guarantee pixel-perfect UI | 44 real Chromium snapshots at 360/390/768/1280 lock the current tokens; owner mock-ups override Parts 5–7 |

## Technical decisions and deviations

* **Tailwind / vite-plugin-pwa not used.** The locked Part-5 tokens are implemented in hand-authored `apps/web/src/styles.css` with CSS logical properties (`margin-inline`, `padding-block`, `inset-inline`), RTL/LTR, dark theme, and print sizes; the PWA is a hand-written `public/sw.js` + `public/manifest.webmanifest`. Reason: avoid a build-time dependency that could not be verified offline, while keeping every token and cache rule explicit. The service worker never caches private `/api/*`.
* **Browser print, not server PDF.** `apps/web/src/print.tsx` uses `createPortal` into `document.body` so `@media print` can hide the SPA; A4/A5/80 mm use named `@page` rules. «PDF» in the UI explicitly means browser Print → Save as PDF.
* **Local preview uses `node:sqlite`** (`DatabaseSync`, Node 22) with `BEGIN/COMMIT` around `db.batch()`; production uses the D1 binding. `better-sqlite3` was deliberately abandoned after a native-build failure.
* **Public cache** uses the edge Cache API with 60–300 s TTL and is purged on product/CMS change. `purgePublicCache()` now tracks known keys, calls `caches.default.delete()` and bumps a generation counter (`zt-public:v<n>:<key>`), so stale HITs disappear locally. *Remaining gap:* real Cloudflare edge behaviour is unverified. See `docs/KNOWN_LIMITATIONS.md`.
* **Offline sync triggers**: app open, `online` event, 60 s timer while visible, manual «Sync Now». Background Sync alone is insufficient. Two devices selling the same last stock produce a flagged `CONFLICT`, never a silent overwrite.
* **Offline PIN cache encryption** (`apps/web/src/offline-security.tsx`, `pin-crypto.ts`): PBKDF2-SHA256 310,000 iterations → non-extractable AES-256-GCM key; role-scoped `refs` and `drafts` are stored encrypted at rest, key only in memory, dropped on lock/logout/reload. The `outbox` stays readable so queued operations can sync. 4 unit tests + `scripts/e2e-pin.mjs` browser E2E (4/4 encrypted IndexedDB rows) pass. The PIN is never transmitted or stored.
* **Backups**: NDJSON chunks → gzip → AES-GCM (12-byte IV prefix) → `backups/`; key from `BACKUP_ENCRYPTION_KEY`. D1 Time Travel is only a safety net. A backup is considered valid only after `scripts/restore.ts` passes on staging.
* **Security**: PBKDF2 ≥310,000 iterations, secure cookies, CSRF header (verified on 29 write routes), Zod validation, parameterised SQL, CMS sanitiser, CSP/HSTS/X-Content-Type-Options/Referrer-Policy, private R2, magic-byte/size validation, AES-GCM CNIC, audit on sensitive actions. `tests/app-security.test.ts` covers CSRF, RBAC/IDOR reads, SQLi payloads and stored XSS.
* **WebAuthn passkeys** (`migrations/0004_webauthn.sql`, `apps/worker/src/routes/passkeys.ts`, `apps/web/src/passkeys.ts`): `@simplewebauthn` v14, one-time server-side challenge consumed only AFTER successful verification, credential counter updated, revoke supported. Real Chromium virtual-authenticator E2E passes (`A15_E2E_PASS`). Passkeys store public keys only — no biometric ever reaches the server. Local RP defaults are `localhost` / `http://localhost:3000`; production `RP_ID` / `RP_ORIGIN` must be the owner's final domain.
* **Browser verification tools**: `scripts/browser.mjs` boots `@sparticuz/chromium` 153 with AL2023 libs; `scripts/{e2e-passkeys,e2e-pin,visual-baselines,lighthouse,a11y,print-proof}.mjs` produce the reports in `docs/`. A physical Android device screenshot is still INCOMPLETE.

## External facts checked earlier (2026-11-03) — RE-VERIFY BEFORE DEPLOY

* D1 free caps 5 M reads/day + 100 K writes/day; daily cap → query errors until 00:00 UTC reset; Paid includes 25 B reads / 50 M writes per month; $5/month minimum. [1](https://developers.cloudflare.com/d1/platform/pricing/) [2](https://developers.cloudflare.com/d1/platform/limits/) [3](https://workers.cloudflare.com/plans)
* Time Travel 7 days Free / 30 days Paid; Free DB max 500 MB, 10 DBs/account; Paid DB max 10 GB; 100 bound parameters per query. [2](https://developers.cloudflare.com/d1/platform/limits/)
* Workers CPU 10 ms Free / 5 min ceiling (30 s default) Paid; I/O wait excluded. [4](https://developers.cloudflare.com/workers/platform/limits/)
* R2 free tier 10 GB-month, 1 M Class A, 10 M Class B, free egress. [5](https://developers.cloudflare.com/r2/pricing/)
* Punjab pesticide dealer eBiz application window reported until 5 Nov 2026 with training 6–12 Nov 2026 (press report, **owner must verify**); the 1971 Ordinance and secondary sources mention 3-year registration/licence periods. [6](https://propakistani.pk/2026/10/29/how-to-apply-for-a-pesticide-dealer-license-in-punjab/) [7](http://punjablaws.gov.pk/laws/1211a.html) [8](https://www.scribd.com/document/147954757/Licencing-of-Dealers-and-Vendors-of-Pesticides)

**Could not be re-verified from this sandbox** (outbound limited to github.com / npm / pypi). The owner
re-pasted v2.0 figures that differ in places (e.g. free D1 5 GB total / 500 MB per DB, a 1 Sep 2026 hard
fail, 1000/50 queries per invocation, 100 bound params, Cron 15 min, Workers Paid 30 s/5 min, R2 10 GB,
Time Travel 7/30 days). Treat all numbers above as provisional and re-check against live Cloudflare docs
at deploy time. **No regulatory figure in this software is presented as authoritative** — the owner must
confirm current rules with the District Agriculture Office, Layyah.
