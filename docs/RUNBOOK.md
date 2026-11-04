# RUNBOOK — operations, deployment and restore

> **Deployment is INCOMPLETE.** A NEW project config `wrangler.v2.jsonc` (`zt-v2-*`) is READY and its
> staging/production dry-runs exit 0, but no Cloudflare resource was created: `api.cloudflare.com` is
> unreachable from this sandbox and the domain is deferred. Steps 4–8 are written but **not executed**.
> Use `wrangler.v2.jsonc` (not the old `wrangler.jsonc`) and `docs/NEW_PROJECT_DEPLOY.md`.

## 1. Local preview / development

```bash
npm install --no-audit --no-fund
npm run migrate:local     # all migrations/*.sql -> .dev/zt.db (77 tables)
npm run build:web         # apps/web/dist
npm run server            # one port: SPA + real Hono API, 0.0.0.0:3000
npm run check:all         # typecheck, 54 tests, query-plan gate, build
npm run docs:features     # regenerate docs/FEATURE_CHECKLIST.md from live API
npm run e2e:passkeys      # real Chromium virtual-authenticator passkey E2E
npm run e2e:pin           # PIN gate + encrypted IndexedDB E2E
npm run test:visual       # 44 baselines / 0 % drift at 360/390/768/1280
npm run test:a11y         # axe-core, 8 pages, 0 violations
npm run test:lighthouse   # Lighthouse 13 mobile, 3 pages
npm run test:print        # Urdu A4 PDF + desktop/Android-emulated screenshots
npm run deploy:dryrun     # new project staging + production dry-run (no network needed)
```

On first start the server prints a **one-time setup token** and stores four random secrets in `.dev/secrets.json` (mode `0600`, git-ignored). `EXPOSE_SETUP_TOKEN=1` is set **only** in local preview; production must never set it.

## 2. First-time setup (owner)

1. Open `/erp` → 7-step wizard.
2. Enter the owner name/username/mobile and a ≥10-character password. No default password exists.
3. Confirm **1 من = ? kg** (owner value). Per-maund grain rates are blocked until confirmed.
4. Optionally enter opening cash/bank balances and the fiscal year (default July–June).
5. Optionally enter **real** pesticide/fertiliser licence numbers + expiry. Never invent them.
6. Finish. `/api/v1/setup` can never run again; a session is created automatically.

Production catalogue stays empty. Add products via `/erp/products/new` or `/erp/products/import` (preview → atomic confirm).

## 3. Daily operations

| Task | Where |
|---|---|
| Purchase / sale / quick entry | `/erp/fertilizer`, `/erp/pesticide`, `/erp/goods/:book`, `/erp/grains/:crop`, FAB |
| Receipts / payments / transfers | `/erp/khata`, `/erp/accounts` |
| Stock, FEFO, expiry, count | `/erp/inventory`, `/erp/reports?report=expiry` |
| Legal registers | `/erp/reports?report=pesticide-register`, `fertilizer-register` |
| Trial balance / P&L / integrity | `/erp/accounting`, `/erp/reports?report=trial-balance` |
| Offline conflicts | `/erp/sync` (ACCEPT reposts, REJECT requires a reason; both audited) |
| D1 usage 70 % warning | `/erp` dashboard, `/erp/settings`, `/api/v1/usage` |
| Publication + cache purge | `/erp/website` → «شائع کریں / کیش صاف» |

Cron (19:00 UTC = 00:00 PKT) runs integrity, encrypted backup, cleanup and notifications. See `apps/worker/src/cron.ts`.

## 4. Cloudflare prerequisites (NOT DONE)

1. Verify limits/prices again at deploy time — the 2026-11-03 figures could NOT be re-checked here.
2. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as **environment variables only** (never in Git).
   Use fresh/rotated credentials; the ones pasted in chat must be revoked.
3. Create ALL-NEW resources: `zt-v2-staging`, `zt-v2-production` D1 and `zt-v2-files-*`,
   `zt-v2-backups-*` R2 buckets. Do not reuse any old ID.
4. Put the new D1 UUIDs into `wrangler.v2.jsonc` (`REPLACE_WITH_NEW_*_D1_UUID`), set `RP_ID`/`RP_ORIGIN`
   to the final domain BEFORE enrolling passkeys, and set the domain/routes.
5. Choose **Workers Paid** (Free's 10 ms CPU and 100 k writes/day are inadequate for posting batches).
6. Set secrets — never in files, never in git:
   ```bash
   npx wrangler secret put SETUP_TOKEN            -c wrangler.v2.jsonc --env staging
   npx wrangler secret put SESSION_SECRET         -c wrangler.v2.jsonc --env staging
   npx wrangler secret put DATA_ENCRYPTION_KEY    -c wrangler.v2.jsonc --env staging
   npx wrangler secret put BACKUP_ENCRYPTION_KEY  -c wrangler.v2.jsonc --env staging
   ```
   The deploy operator prints `SETUP_TOKEN` **once**; `EXPOSE_SETUP_TOKEN` must stay unset.
7. `npm run build:web` → `npm run deploy:dryrun` → `wrangler d1 migrations apply ... --remote` →
   `wrangler deploy -c wrangler.v2.jsonc --env staging`, verify HTTP, then repeat for production.
   Real URLs may be reported **only after** an HTTP check. Full commands: `docs/NEW_PROJECT_DEPLOY.md`. Alternatively run the `workflow_dispatch` workflow
`.github/workflows/deploy-v2.yml` from GitHub Actions after adding the repository secrets; it creates only
`zt-v2-*` resources. One real dispatch (run `41641152183`) failed at the secret guard; re-run after adding
the secrets.

## 5. Backups

* Format: NDJSON `{"table":…,"row":{…}}` → gzip → AES-GCM with a 12-byte IV prefix.
* Nightly cron + manual `/erp/backup` → «ابھی بیک اپ چلائیں» (`POST /api/v1/backup/run`).
* Storage: `backups/<YYYY-MM-DD>/<ulid>.ztbak` in private R2 (local preview: `.dev/backups/`).
* Retention: `backup_retention` setting. **D1 Time Travel (7 d Free / 30 d Paid) is a safety net only — never a substitute.**
* `backup_logs.staging_restore_result` starts as `NOT_TESTED`. A backup is valid only after a staging restore passes.

## 6. Restore — STAGING FIRST, ALWAYS

```bash
# 1. download the object from R2 to a file (or use /api/v1/backup/download)
# 2. verify decrypt + parse without writing
npx tsx scripts/restore.ts --file ./backup.ztbak --key "$BACKUP_ENCRYPTION_KEY" --verify-only

# 3. restore into a disposable STAGING database, never production
npx tsx scripts/restore.ts --file ./backup.ztbak --key "$BACKUP_ENCRYPTION_KEY" \
  --target .dev/restore-test.db --i-know-this-is-staging

# 4. check the printed result: foreign_key_check PASS + journal_balanced true
cat .dev/restore-test.db.restore-result.json
```

The script refuses: missing `--i-know-this-is-staging`, a target path containing `production`, or overwriting `.dev/zt.db`.
It applies all migrations to a fresh DB, `DELETE`s restored tables, inserts with `INSERT OR REPLACE` inside one transaction (FKs off), then re-enables FKs and runs `PRAGMA foreign_key_check` + journal-balance check.

**Real result obtained locally (2026-11-03):** 1032 rows / 48 tables restored, `foreign_key_check: PASS`, `journal_balanced: true`, debit = credit = 97,939,267 paisa. See `docs/TEST_REPORT.md`. A Cloudflare staging restore is still **INCOMPLETE**.

## 7. Incident: wrong price / wrong posting

Never edit or delete a posted row (H2). Use `/erp/returns` (reversal + replacement with reason) or a manual balanced journal in `/erp/accounting`. Every sensitive action is in `/erp/audit`. For a period already closed, posting is rejected with `PERIOD_CLOSED`; post a reversal in an open period with an explicit reason.

## 8. Incident: conflict / duplicate

`/erp/sync` shows `CONFLICT` rows. ACCEPT re-attempts the same `idempotency_key` (safe), REJECT requires a reason. Never clear the Dexie outbox manually. If two devices sold the last stock, the conflict is *flagged*, never silently overwritten.

## 9. Incident: quota

`/api/v1/usage` reports rows read/written and `read_pct`/`write_pct`. At ≥70 % of the free caps, the dashboard warns and the plan should be upgraded to Workers Paid. Free-cap exhaustion makes D1 queries return errors until the 00:00 UTC reset.
