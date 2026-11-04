# NEW PROJECT — deployment record

**Status: DEPLOYED on 2026-11-03 (§9).** The owner asked for a completely new project (new Worker,
new D1, new R2 — "old project ko touch nahi karo") and to do the domain later.
Sections 1–8 are the preparation and the earlier blocked attempts (kept as history);
**§9 is what actually ran.** R2 buckets are still pending — the account has not enabled R2 (§9.4).

> **Note on §2/§7:** those sections recorded `api.cloudflare.com` as unreachable from the earlier
> sandbox. That blocker no longer applies on the deploy machine, where the API answered normally.

## 1. What is new (nothing old was touched)

| Resource | NEW name | Old name (untouched) |
|---|---|---|
| Worker | `zt-v2` / `zt-v2-staging` | `zeeshan-traders` in `wrangler.jsonc` |
| D1 | `zt-v2-staging`, `zt-v2-production` | `zt-staging`, `zt-production` |
| R2 files | `zt-v2-files-staging`, `zt-v2-files-production` | `zt-private-staging`, `zt-private-production` |
| R2 backups | `zt-v2-backups-staging`, `zt-v2-backups-production` | (none) |
| Config | `wrangler.v2.jsonc` (new file) | `wrangler.jsonc` (unchanged) |

No Cloudflare API call was made, so **no existing Worker, D1 database or bucket was modified**.

## 2. Why there is no deployment / live URL (real evidence)

```
$ curl -sS --max-time 8 -o /dev/null -w 'http=%{http_code}' https://api.cloudflare.com/client/v4/
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to api.cloudflare.com:443
http=000
$ curl -sS --max-time 8 -o /dev/null -w 'http=%{http_code}' \
    https://<ACCOUNT_ID>.r2.cloudflarestorage.com/
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL ...
http=000
$ curl -sS --max-time 8 -o /dev/null -w 'http=%{http_code}' https://registry.npmjs.org/
http=200
```
This sandbox only permits `github.com`, `codeload.github.com`, `api.github.com`,
`registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. Wrangler bundles locally but
`d1 create`, `r2 bucket create`, `d1 migrations apply` and `deploy` all need
`api.cloudflare.com`. Therefore: **no D1 created, no R2 created, no remote migrations,
no deploy, no verified URL.** Nothing was faked (hard rule H10).

## 3. Config validated for real (local dry-run)

```
$ npx wrangler deploy --dry-run -c wrangler.v2.jsonc --env staging
Total Upload: 1340.52 KiB / gzip: 244.44 KiB
env.DB (zt-v2-staging)  D1 Database · env.FILES (zt-v2-files-staging)  R2 Bucket · env.ASSETS
--dry-run: exiting now.                         → exit 0, 0 warnings

$ npx wrangler deploy --dry-run -c wrangler.v2.jsonc --env production
Total Upload: 1340.52 KiB / gzip: 244.44 KiB   → exit 0, 0 warnings
```
This also proves the Cloudflare Worker bundle (including the new WebAuthn passkey routes)
compiles with `nodejs_compat`.

## 4. Credentials — handled safely

The owner pasted an Account ID, an API token and R2 S3 credentials into the chat.
The **API token and R2 S3 keys were never written to any file, never committed, never
echoed in command output and never used** (the Cloudflare API is unreachable here).
The Account ID was initially written into `wrangler.v2.jsonc` and this document; it has
since been **removed from both** and must be supplied as `CLOUDFLARE_ACCOUNT_ID` on the
deploy machine. Treat it as an identifier, not a secret, but keep it out of Git. Two different token strings
appeared in the message: the "Your API Token" value and a longer one inside the curl
example (one extra trailing character). Use the **"Your API Token"** value and verify it
with `GET /accounts/{account_id}/tokens/verify` before any deploy.

> ⚠️ Because the token and S3 Secret Access Key were exposed in a chat message, **rotate /
> revoke them in the Cloudflare dashboard** and create fresh ones on the deploy machine.
> Never commit them; never enable `EXPOSE_SETUP_TOKEN` in production.

## 5. Commands to run on a machine WITH Cloudflare access

```bash
export CLOUDFLARE_API_TOKEN='<fresh token>'          # never commit
export CLOUDFLARE_ACCOUNT_ID='<your account id>'   # never commit
cd /home/user/trade
npm install --no-audit --no-fund
npm run build:web

# 1. Create ALL-NEW resources (do not reuse any old ID)
npx wrangler d1 create zt-v2-staging     -c wrangler.v2.jsonc
npx wrangler d1 create zt-v2-production  -c wrangler.v2.jsonc
npx wrangler r2 bucket create zt-v2-files-staging
npx wrangler r2 bucket create zt-v2-files-production
npx wrangler r2 bucket create zt-v2-backups-staging
npx wrangler r2 bucket create zt-v2-backups-production
# 2. Paste the two returned database_id values into wrangler.v2.jsonc
#    (REPLACE_WITH_NEW_STAGING_D1_UUID / REPLACE_WITH_NEW_PRODUCTION_D1_UUID).

# 3. Secrets (names only; values via `wrangler secret put`, one per environment)
for E in staging production; do
  npx wrangler secret put SETUP_TOKEN            -c wrangler.v2.jsonc --env "$E"
  npx wrangler secret put SESSION_SECRET         -c wrangler.v2.jsonc --env "$E"
  npx wrangler secret put DATA_ENCRYPTION_KEY    -c wrangler.v2.jsonc --env "$E"
  npx wrangler secret put BACKUP_ENCRYPTION_KEY  -c wrangler.v2.jsonc --env "$E"
done
# TURNSTILE_SECRET / TURNSTILE_SITEKEY are optional (the gate is off without the secret).

# 4. Migrations on each fresh D1, then staging deploy
npx wrangler d1 migrations apply zt-v2-staging    --remote -c wrangler.v2.jsonc --env staging
npx wrangler deploy -c wrangler.v2.jsonc --env staging
# 5. Verify staging: /api/v1/health, /, /erp, /api/v1/public/home, /api/v1/features,
#    first nightly backup, and a RESTORE INTO STAGING (scripts/restore.ts) before production.
npx wrangler d1 migrations apply zt-v2-production --remote -c wrangler.v2.jsonc --env production
npx wrangler deploy -c wrangler.v2.jsonc --env production
```

**Before the owner enrols a passkey**, set `RP_ID` and `RP_ORIGIN` in the environment vars
to the final domain — WebAuthn credentials are domain-bound (Part 10.3). The domain is
deferred by the owner, so passkeys currently use `localhost` only for local E2E tests.

Recommend **Workers Paid** for production (free plan: 10 ms CPU/request and daily D1
read/write caps that fail queries once hit). Re-verify every Cloudflare limit/price on the
live docs on the deploy date; figures researched 2026-11-03 are in `docs/ASSUMPTIONS.md`.

## 6. What remains INCOMPLETE until step 5 is actually run

`P12-DEPLOY`, real staging restore (`A16` / `P12-RESTORE`), production R2 binding,
real Cloudflare edge cache purge verification, real Turnstile siteverify, a live public URL,
and a physical-Android-Chrome Urdu PDF screenshot. All are labelled honestly in
`/erp/status`, `docs/KNOWN_LIMITATIONS.md` and the final report.

## 7. REAL deploy attempt from this sandbox (2026-11-03, 12:53 PKT)

The owner asked to deploy after the push. A real `wrangler deploy` WAS attempted; no result was faked:

```
$ curl -sS --max-time 8 -o /dev/null -w 'api.cloudflare.com http=%{http_code}' https://api.cloudflare.com/client/v4/
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to api.cloudflare.com:443
api.cloudflare.com http=000
$ curl -sS --max-time 8 -o /dev/null -w 'registry.npmjs.org http=%{http_code}' https://registry.npmjs.org/
registry.npmjs.org http=200
$ env | grep -c '^CLOUDFLARE_'
0
$ CI=1 npx wrangler deploy -c wrangler.v2.jsonc --env staging
⛅️ wrangler 4.45.0
✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN
   environment variable for wrangler to work.
deploy_exit=1
```

Two independent blockers: (1) no Cloudflare credential is stored in this workspace — the API token and
R2 S3 keys pasted in chat were deliberately **never persisted** (and must be rotated); (2) outbound
network is limited to github.com / npm / pypi, so even with a token `api.cloudflare.com` is unreachable.
**Therefore: no deploy, no D1, no R2, no verified URL. Deployment remains INCOMPLETE.**

## 8. Safe one-click path — GitHub Actions (`.github/workflows/deploy-v2.yml`)

GitHub Actions runners CAN reach Cloudflare, so the owner supplies access **securely through GitHub
Secrets** — never in chat, never in Git:

1. GitHub → Settings → Secrets and variables → Actions → **New repository secret**, add:
   `CLOUDFLARE_API_TOKEN` (fresh/rotated), `CLOUDFLARE_ACCOUNT_ID`, `V2_SETUP_TOKEN`,
   `V2_SESSION_SECRET`, `V2_DATA_ENCRYPTION_KEY`, `V2_BACKUP_ENCRYPTION_KEY`.
   Generate the last three with `openssl rand -base64 32`. `V2_SETUP_TOKEN` is shown to the operator
   once and used for the one-time `/api/v1/setup`.
2. Optional: `TURNSTILE_SECRET`, `TURNSTILE_SITEKEY` once the real widget exists.
3. Actions → **Deploy zt-v2 (NEW project only)** → Run workflow → choose `staging` →
   type `CREATE-NEW`. The workflow verifies the token, runs `check:all` + `deploy:dryrun`, creates
   ONLY `zt-v2-*` D1/R2 resources, applies remote migrations, sets Worker secrets, deploys and prints
   the real URL. Repeat with `production` only after staging is verified.
4. Enter `rp_id` / `rp_origin` ONLY after the final domain is chosen; WebAuthn credentials are
   domain-bound, so passkeys must be enrolled afterwards.

The workflow is `workflow_dispatch`-only with a confirmation phrase: it cannot run accidentally and
never references the old project. Both environments set `workers_dev: true`, so a successful deploy
gets Cloudflare's **free `*.workers.dev` URL** first; the custom domain is linked later as the owner asked.

### Real dispatch (2026-11-03) — it ran, but stopped at the secret guard

PR #2 (`arena/31aaac0f-trade` → `main`) was merged so the workflow exists on the default branch.
A real manual dispatch was then made:

```
$ gh workflow run deploy-v2.yml --ref main -f environment=staging -f confirm=CREATE-NEW
dispatch_exit=0
$ gh run view 41641152183 --json status,conclusion,url
{"conclusion":"failure","status":"completed",
 "url":"https://github.com/sastishoppingstore/trade/actions/runs/41641152183"}
```

Runner log (real output):
```
X Missing repository secret: CLOUDFLARE_API_TOKEN
X Missing repository secret: CLOUDFLARE_ACCOUNT_ID
X Missing repository secret: V2_SETUP_TOKEN
X Missing repository secret: V2_SESSION_SECRET
X Missing repository secret: V2_DATA_ENCRYPTION_KEY
```

No Cloudflare resource was created and **no live URL exists**. `gh secret list` from this sandbox returns
`HTTP 403: Resource not accessible by integration`, so the agent cannot add those secrets either — only
the repository owner can, through GitHub → Settings → Secrets and variables → Actions. Once the six
secrets are present, re-run the same workflow: it will create the `zt-v2-*` D1/R2 resources, apply remote
migrations, deploy and print the real `*.workers.dev` URL. Deployment remains **INCOMPLETE**.

## 9. DEPLOYED FOR REAL — 2026-11-03 (PKT)

The deploy machine reaches `api.cloudflare.com` (`https://api.cloudflare.com/client/v4/` → `http=404`,
i.e. the endpoint answered; the old `SSL_ERROR_SYSCALL` blocker is gone). The owner re-supplied the
Account ID and API token for this purpose. `POST /accounts/{id}/tokens/verify` →
`{"result":{"status":"active"},"success":true}`.

### 9.1 Pre-existing resources — inventory taken BEFORE the first write

```
Workers : ai-agent-api, bright-future-school, candeur-diag, petrol-pump-erp,
          qjh-api, qureshi-job-hunter                      (6 workers, none touched)
D1      : school_erp_db, qjh_db, ai_agent_db, petrol_pump_erp_db   (4 databases, none touched)
Pages   : 0 projects
```
No `zeeshan-traders` Worker/D1/bucket existed on this account, so the "old project" names in
`wrangler.jsonc` were never live resources. All new resources use the `zt-v2-*` prefix only.

### 9.2 What was created (all NEW)

| Step | Command | Real result |
|---|---|---|
| D1 staging | `POST /accounts/{id}/d1/database {"name":"zt-v2-staging"}` | `success:true` uuid `769a4c89-4748-420a-b1cc-02ae6f791f6e` |
| D1 production | `POST /accounts/{id}/d1/database {"name":"zt-v2-production"}` | `success:true` uuid `cc5e1948-6e54-496e-9e56-b9fc01f86a21` |
| Migrations | `wrangler d1 migrations apply zt-v2-staging --remote --env staging` | `0001_init.sql`…`0004_webauthn.sql` all ✅, exit 0 |
| Migrations | same for `zt-v2-production --env production` | all ✅, exit 0 |
| Secrets | `wrangler secret put SETUP_TOKEN / SESSION_SECRET / DATA_ENCRYPTION_KEY / BACKUP_ENCRYPTION_KEY` | 8/8 exit 0 (both envs) |
| Deploy | `wrangler deploy -c wrangler.v2.jsonc --env staging` | exit 0 → `https://zt-v2-staging.sastishopping-store.workers.dev` |
| Deploy | `wrangler deploy -c wrangler.v2.jsonc --env production` | exit 0 → `https://zt-v2.sastishopping-store.workers.dev` |

Both environments keep `workers_dev: true`, so the free `*.workers.dev` subdomain
(`sastishopping-store`) serves them; the custom domain stays deferred by the owner, as asked.
Cron `0 19 * * *` is registered on both.

### 9.3 Live verification (real HTTP against the deployed Workers)

```
GET /api/v1/health        200 {"ok":true,...,"runtime":"cloudflare-worker"}
GET /                     200 1431 B (index.html)
GET /erp                  200 1431 B   ← SPA fallback (see 9.5)
GET /api/v1/public/home   200 2321 B   ← ذیشان ٹریڈرز business profile from remote D1
GET /api/v1/features      200 {"COMPLETE":45,"PARTIAL":19,"INCOMPLETE":0}
GET /api/v1/setup/status  200 setup_complete:false, owner_exists:false
POST /api/v1/setup (wrong token) 403 INVALID_SETUP_TOKEN   ← proves the secret is set; nothing written
wrangler d1 execute zt-v2-production --remote --command
  SELECT (SELECT COUNT(*) FROM d1_migrations), (SELECT COUNT(*) FROM business_settings),
         (SELECT COUNT(*) FROM chart_of_accounts)
    → migrations 4 · settings 30 · chart_of_accounts 67
  SELECT COUNT(*) FROM sqlite_master WHERE type='table' → 80
```
`GET /api/v1/features.integrity` reports `ok:true` with `unbalanced_journals:0` computed on the real
remote D1. Catalogue is empty by design (H8) — nothing was seeded or invented.

Local gates re-run on the deploy machine: `npm run typecheck` clean, `npm test` → 7 files / **54 tests
passed**, `npm run query:plan` → **15/15 hot queries indexed, 0 full scans**, `npm run build:web` →
130 modules, and `npx wrangler deploy --dry-run` exit 0 for both envs.

### 9.4 STILL NOT DONE (honest gaps)

* **R2 is not enabled on this account.** `PUT /accounts/{id}/r2/buckets/zt-v2-files-staging` →
  `{"success":false,"errors":[{"code":10042,"message":"Please enable R2 through the Cloudflare Dashboard."}]}`.
  That is a dashboard-only action, so `zt-v2-files-*` / `zt-v2-backups-*` do not exist and the `FILES`
  binding is commented out in `wrangler.v2.jsonc`. Consequences: product image upload/download and the
  nightly encrypted backup cannot persist; `P8-R2` and `P12-RESTORE` stay `PARTIAL`. Re-enable by
  uncommenting the two `r2_buckets` lines after `wrangler r2 bucket create` succeeds.
* **Owner setup wizard not run** — needs the owner's real values (owner name/username/mobile/password,
  the confirmed `1 من = ? kg`, opening balances). `SETUP_TOKEN` is required at `/api/v1/setup`.
* **Custom domain + `RP_ID`/`RP_ORIGIN`** — deferred by the owner; passkeys are domain-bound, so enrol
  them only after the final domain is set.
* **Real Turnstile `siteverify`** and **real edge Cache purge** — still unverified on the live Worker.
* `TURNSTILE_SECRET`/`TURNSTILE_SITEKEY` intentionally not set (the gate stays off without them).

### 9.5 One code change made during deploy

`/erp` (and every other client-side route) returned **404** on the first deploy: `app.ts:86` delegates to
`c.env.ASSETS.fetch()`, and the SPA fallback exists only in the local `node-server.ts`. Fixed in config,
not code — `assets.not_found_handling = "single-page-application"` plus `run_worker_first = true`
(so `/api/v1/*` stays Worker-owned) in `wrangler.v2.jsonc`. After redeploy `/erp` → 200 `text/html`
and unknown `/api/v1/*` paths still return Worker JSON, not HTML.

The `P12-DEPLOY` / `P12-NEW-PROJECT` labels in `apps/worker/src/routes/ops.ts`, and the matching
assertion in `tests/routes.test.ts`, were updated from INCOMPLETE/PARTIAL to COMPLETE because they
were under-reporting the now-verified deploy. `docs/FEATURE_CHECKLIST.md` was regenerated from the
live `/api/v1/features` endpoint.

### 9.6 Rollback / undo (if the owner wants the new project removed)

```
npx wrangler delete -c wrangler.v2.jsonc --env staging
npx wrangler delete -c wrangler.v2.jsonc --env production
curl -X DELETE .../d1/database/769a4c89-4748-420a-b1cc-02ae6f791f6e
curl -X DELETE .../d1/database/cc5e1948-6e54-496e-9e56-b9fc01f86a21
```
Deleting the two `zt-v2-*` D1 databases also deletes their data; no other resource is affected.

## 10. Design + verification pass, 2026-11-03/04 (local preview, real Chromium)

Everything below was measured against the local preview (`http://localhost:3000`, `.dev/zt.db`) in
headless Chromium. No staging/production data was written by this pass.

### 10.1 Defects found and fixed

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | Urdu nav rendered as tofu boxes (□) | 1280 px capture; `document.fonts.check()` was `true` yet glyphs were missing | all 7 `@font-face` rules: `font-display: optional` → `swap` (`apps/web/src/styles.css`) |
| 2 | ERP screens overflowed horizontally by 40–70 px at 360/390 | `scrollWidth` 430 vs `clientWidth` 360 on `/erp`, `/erp/catalogue`, `/erp/sales`, `/erp/settings`, `/erp/users` | `.erp-main { flex: 1 1 auto; min-width: 0 }` — it had `min-width: 0` only inside the ≥768 px queries |
| 3 | `/erp/returns` rendered a blank screen | `TypeError: (ce.data ?? []).map is not a function` | `/api/v1/sales` and `/api/v1/purchases` return `{rows,next_cursor}`, not an array → `docs.data?.rows ?? []` (`apps/web/src/erpScreens.tsx:1229`) |
| 4 | `/erp/settings` overflowed by **5529 px** at 390 | `.card-list .item` measured 5886 px wide; the raw JSON setting values were one unbreakable token | `.card-list .item > * { min-width: 0 }` + `overflow-wrap: anywhere` on `.t2` |
| 5 | `/erp/products/import` overflowed by 503 px at 390 | the CSV template `<code>` run was unbreakable | `code { overflow-wrap: anywhere; word-break: break-word }` |
| 6 | Print controls sat under the scrim and were unreachable | modal markup review | `print.tsx` now portals ONE `.print-root` holding bar + notes + live preview |
| 7 | 80 mm print ignored its width | print-media rule order | explicit `.print-80mm` inside `@media print` |

### 10.2 Flows verified working (not just styled)

* **Cart → enquiry → ERP inbox**: 3 products added through the real UI (badge `3`), submitted with
  consent → `EQ-2026-000001`, cart cleared, honest notice «نہ ادائیگی ہوتی ہے نہ اسٹاک بدلتا ہے».
  The row then renders in `/erp/enquiries`, and its sheet exposes منظور / مسترد / کوٹیشن / واٹس ایپ.
  Converting it produced `QT-2026-000001` (status `DRAFT`, total 0) and set the enquiry to `CONVERTED`
  while `sales` stayed `0` and `stock_movements` stayed `0` — the enquiry never becomes a sale.
* **Print formats**: with a posted purchase/sale/receipt (`FP-…`, `FS-…`, `RC-…`, each storing
  `template_version = zt-print-1.0`), the three chips genuinely switch templates in the browser —
  A4 794 px / 5 `<th>`, A5 559 px / 4 `<th>`, 80 mm 302 px / 0 `<th>` + 4 dashed separators.
* **ERP screens**: 37 routes swept at 390 px — zero page errors, zero horizontal overflow after fixes 2–5.
  Short-text screens (`/erp/sales`, `/erp/purchases`, `/erp/parties`) show the real empty state because
  those tables are empty locally, not because they are broken.
* **Overflow matrix**: 16 pages × 7 viewports (360/390/480/768/1024/1280/1536) → no page exceeds its
  viewport width.

### 10.3 Local test fixture (never deployed)

`.dev/zt.db` had been recreated, so the browser suites had no owner to sign in as. The documented
`tests/helpers.ts` fixture pattern was reused locally: owner `e2e-owner`, `maund_kg = 40`,
plus 10 sample products, one purchase/sale/receipt and one enquiry. This is a throwaway local
preview database only. **`1 من = ? kg` is still listed as pending owner input** in
`docs/ASSUMPTIONS.md` for staging/production, and the production catalogue remains empty (H8).

## 11. Round of 2026-11-04 — catalogue, brand, social, thermal depth, bundle split

### 11.1 Deploy entry points are now pinned to this project

`npm run deploy:staging|deploy:production|d1:staging|d1:production` previously ran `wrangler` with **no
`-c`**, which resolves `wrangler.jsonc` — the *old* `zeeshan-traders` project with `zt-staging` /
`zt-production` D1 names. Those scripts now carry `-c wrangler.v2.jsonc` and the `zt-v2-*` database
names, so no repo command can reach a pre-existing live project. Verified after deploying:

```
ai-agent-api | modified 2026-10-31      bright-future-school | modified 2026-11-03
candeur-diag | modified 2026-08-12      petrol-pump-erp | modified 2026-09-29
qjh-api | modified 2026-10-31           qureshi-job-hunter | modified 2026-10-31
zt-v2 | modified 2026-11-04             zt-v2-staging | modified 2026-11-04
```

Only the two `zt-v2*` workers changed today. Production migration `0005_checkout.sql` was applied
before deploy; `zt-v2-production` and `zt-v2-staging` are the only targets ever named.

### 11.2 Staging catalogue (34 items), production still empty

`seed/catalogue-staging.sql` was applied to **`zt-v2-staging` only** (`wrangler d1 execute … --file`).
Live check: `/api/v1/public/products` returns 34 rows, 9 with a published rate —
یوریا Rs 4,565 · ڈی اے پی Rs 16,500 · لکی سیمنٹ Rs 1,550 · میپل Rs 1,560 · گندم Rs 4,200 ·
مونجی Rs 2,650 · مکئی Rs 3,100 · باجرہ Rs 3,800 · مونگ Rs 8,000. Every other item is
`availability = CALL` (price on call) because no public source existed for it, and
`purchase_rate_paisa` stays 0 — costs are the owner's to enter (H8, no invented figures).
`zt-v2-production` returns `rows: []` by design.

Local `.dev/zt.db` also carried 10 stale stub products from an earlier import (e.g. `urea-50` at
Rs 1,450 next to the curated `urea` at Rs 4,565). They were repointed onto their curated
equivalents — transactions, quotations, enquiries and stock merged, not deleted — leaving
34 products, 0 orphan references, 0 duplicate slugs and `stock_balance == Σ stock_movements` on
all 34 rows. The pre-cleanup database is kept at `.dev/zt.pre-stub-clean.db`.

### 11.3 Brand mark, icons and the social card

`scripts/brand-assets.mjs` (sharp only, no new dependency) derives every shipped raster from
`images/brand/logo-mark.png`: `icons/icon-{512,192,32}.png`, `icons/apple-touch-icon.png`,
`icons/icon-maskable-512.png` (field colour sampled from the master's own corner pixel, so no seam),
`brand/logo-{256,96}.png`, `og/og-1200x630.jpg` (176 KB), `og/og-2400x1260.webp`, `og/og-4k.webp`.
All 10 URLs return 200 with correct content types on the local server.

Crawlers never execute the SPA, so `apps/worker/src/services/social.ts` rewrites the served HTML:
`og:url`/`og:image` become absolute, and `/product/:slug` gets that product's own title, price and
uploaded photo. Verified on staging:

```
og:title       یوریا (50 کلو بوری) — کھاد
og:description یوریا (50 کلو بوری)۔ قیمت Rs 4,565۔ مقصود چوک، ضلع لیہ — آج کا ریٹ، واٹس ایپ پر آرڈر۔
og:image       https://zt-v2-staging.sastishopping-store.workers.dev/og/og-1200x630.jpg
```

A price-on-call product renders «قیمت کے لیے رابطہ کریں» instead of an invented figure
(`tests/social.test.ts` S4), and S5 proves a quote or tag in a product name cannot escape the
`content="` attribute. `logo_url` comes from the owner's uploaded `logo_r2_key` setting and falls
back to the bundled mark in the header, footer, ERP login and all three print formats.

### 11.4 Invoice formats — depth that survives paper

A4 gained a raised masthead card (logo tile, licence plate, number/date/book chips), a beveled
title pill, an emerald table head with a gold rule, zebra rows, a gold total ribbon and three
settlement cards (بقایا in the red variant). 80 mm is deliberately **one-colour**: inverted black
bars for the header and total, keyline boxes for paid/due — thermal printers have no grey, so
colour depth would print as mud. A5 inherits the masthead and total ribbon.

The preview shows a paper stack (two offset sheets behind the real one) — `@media screen` only;
`@media print` resets every shadow so the sheet is flat on paper. `npm run test:print` →
**PASS (6 renderings)**, Nastaliq + Naskh both loaded, `overflowX=false` on all three formats.

### 11.5 Hero cube faces are product cards

The cube's four side faces are live catalogue cards (photo, Urdu name, published price, and the
forward-facing card is a real `<Link>` to `/product/:slug`). The caption row under the cube is
suppressed for product faces — it repeated the card's own name and the −13° tilt threw the face's
lower edge over it; dots got 16 px of clearance.

### 11.6 ERP bundle is now a separate chunk

`main.tsx` lazy-loads `ErpApp` behind a Suspense fallback, so a customer never downloads the back
office: `index.js` **471 KB → 299 KB** (gzip 129.8 → 87.1 KB) and `erp.js` 173 KB (gzip 44.4 KB)
arrives on demand. `npm test` 71/71 and the ERP browser sweep still renders dashboard, settings,
users, status and login at `http=200` with `page_errors=0`.

### 11.7 Test harness fixes found on the way

* `scripts/lighthouse.mjs` hardcoded the bundled x86 `/tmp/chromium`, which cannot exec on this
  arm64 box; it now prefers the machine's own Chromium and only inflates the bundled build as a
  fallback. It also no longer POSTs a fixture product into the database — it audits a real
  published item, so repeated runs stop leaving junk in the catalogue.
* `scripts/visual-baselines.mjs` froze the page clock and waits for network idle plus image decode,
  so a diff means the code changed rather than the moment the shutter fell.
* Baselines were regenerated after the redesign; `page_errors=0` across all 44 captures.
  Residual: 9 captures at 360/390 px still differ by 2–4 % between runs on the data-driven ERP
  screens (dashboard/users/status) — reported, not hidden.

### 11.8 Staging was one migration behind — found by probing, not assuming

`/api/v1/public/payment-methods` returned `500 D1_ERROR: no such table: payment_methods` on staging:
`0005_checkout.sql` had been applied to production only. Applied to `zt-v2-staging` and re-probed:

```
/api/v1/public/payment-methods   200  {"ok":true,"data":[]}     ← empty until the admin uploads a QR/bank
/api/v1/payment-methods          401  UNAUTHENTICATED           ← write side stays behind auth
/api/v1/public/home              200
```

The empty array is the honest state: no bank account or QR is invented (H8). The owner adds them in
ERP → ادائیگی کے طریقے, and checkout then shows them with the 3D product cards.
