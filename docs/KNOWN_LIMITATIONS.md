# KNOWN LIMITATIONS — honest list (2026-11-03)

Anything unfinished is labelled `INCOMPLETE` or `PARTIAL` in `/erp/status` (`GET /api/v1/features`),
`docs/FEATURE_CHECKLIST.md` and the final report. Current live totals:
**64 features — 43 COMPLETE, 20 PARTIAL, 1 INCOMPLETE.** Nothing here is presented as done.

## Resolved in this session (no longer gaps)

* WebAuthn passkeys (A15): real `@simplewebauthn` verification, one-time challenges, revoke, browser E2E.
* PIN offline cache: browser E2E confirmed 4/4 encrypted IndexedDB rows; 4 unit tests.
* Playwright-style visual regression: 11 pages × 4 viewports = 44 real Chromium baselines, 0 % drift.
* Lighthouse mobile: 100/100/100 on `/`, `/products`, `/product/:slug`; axe-core: 0 violations on 8 pages.
* Urdu A4 print/PDF proof on desktop + Android-emulated Chromium (a *physical* device is still untested).
* App-wide CSRF (29 write routes), RBAC/IDOR private reads, SQLi and stored-XSS gates (5 new tests).
* A19 dedicated quota/cache test; generation-aware cache purge; Turnstile server gate + local tests.
* New-project `wrangler.v2.jsonc` with staging/production dry-runs (exit 0, 0 warnings).

## INCOMPLETE / unverified

1. **R2 buckets (`P8-R2`, `P12-RESTORE`)** — still PARTIAL. R2 is not enabled on this Cloudflare
   account: `PUT /accounts/{id}/r2/buckets/zt-v2-files-staging` returns
   `{"success":false,"errors":[{"code":10042,"message":"Please enable R2 through the Cloudflare Dashboard."}]}`.
   Enabling it is a dashboard-only action, so `zt-v2-files-*` / `zt-v2-backups-*` do not exist and the
   `FILES` binding is commented out in `wrangler.v2.jsonc`. Every `c.env.FILES` use is guarded
   (`routes/ops.ts`, `routes/catalogue.ts`), so product image upload and R2 backup writes are unavailable
   while the rest of the app works. The restore test therefore remains local-only.
2. **Cloudflare deployment (`P12-DEPLOY`)** — COMPLETE on 2026-11-03: both `zt-v2` and `zt-v2-staging`
   are live on `*.workers.dev` with all four migrations applied remotely and secrets set
   (`docs/NEW_PROJECT_DEPLOY.md` §9 has the real commands and evidence). The old `wrangler.jsonc`
   and every pre-existing Worker/D1 on the account remain untouched.

   *Superseded history:* until 2026-11-03 the earlier sandbox could only reach github.com / npm / pypi
   (`api.cloudflare.com` → `curl (35) SSL_ERROR_SYSCALL`, `http=000`), so `wrangler deploy` exited 1 with
   no credential env vars, and the `workflow_dispatch` workflow (`.github/workflows/deploy-v2.yml`, run
   `https://github.com/sastishoppingstore/trade/actions/runs/41641152183`) failed at its guard because the
   six repository secrets were absent. The deploy was completed directly instead, with the credentials
   supplied at deploy time and never committed.
3. **Domain / RP ID** — deferred by the owner. WebAuthn credentials are domain-bound, so passkeys must
   be enrolled only after the final domain is set.
4. **Real Cloudflare Turnstile `siteverify`** — the server gate is implemented and unit-tested with an
   injected verifier; the real CF service has not been called.
5. **Real Cloudflare edge Cache API purge** — generation-based invalidation + known-key deletion pass
   locally; behaviour of `caches.default` on the edge is unverified.
6. **Real staging D1 restore (A16)** — a local staging-equivalent restore passed (1032 rows, FK +
   journal PASS); `staging_restore_result` remains `NOT_TESTED` for production purposes.
7. **Nightly encrypted backup to production R2** — local fallback writes `.dev/`; production R2 binding
   and the live Cron run are unverified. `scripts/backup` returns `501 INCOMPLETE_R2` where R2 is absent.
8. **Physical Android Chrome screenshot** — only viewport/user-agent emulation was captured.
9. **13 phase-by-phase `Phase n done: <evidence>` commits** — not made; see `docs/PHASES.md`.
10. **Re-verification of external figures** — Cloudflare limits/prices and Punjab pesticide/fertiliser
    regulatory facts cannot be re-fetched from this sandbox; re-check at deploy time.
11. **Concurrent duplicate `idempotency_key` protection** — `Posting.syncOperation()` uses
    `ON CONFLICT DO NOTHING`; sequential duplicates are safe, two truly concurrent same-key posts could
    double-post. Needs a unique index + conditional-write fix.
12. **Owner-supplied values** — 1 من = ? kg, bag sizes/unit conversions, licence numbers + expiry,
    opening balances, legal copy, domain and Cloudflare access were never invented and remain `NEEDS OWNER INPUT`.

## PARTIAL (works, narrower than the master prompt)

* 20 `/erp/status` items are PARTIAL, notably: CMS legal text is `REVIEW_REQUIRED` until owner legal
  review (`PUB-06`, `PUB-08`); global search index; MANUAL allocation picker; returns line picker;
  enquiry→Sale one-click conversion; quarantine workflow UI; banner upload UI; party edit/archive UI;
  employee advance form; bulk statement packs; full report gallery + scheduled emails; standalone
  offline page; production R2 binding; real Turnstile; real staging restore; new-project config not deployed.
* 12 reports are wired; advanced reconciliation views are not.
* Private R2 uploads work in local preview via a local upload dir; production requires the R2 binding.
* Quarter/period locking, CNIC encryption, audit and RBAC are implemented; a route-by-route IDOR matrix
  with real cross-tenant records is not automated (only deny-by-default role cases are).
* `@playwright/test`'s own spec runner (`tests/visual/erp.spec.ts`, `playwright.config.ts`) exists but the
  committed visual evidence comes from `scripts/visual-baselines.mjs` (playwright-core + pixelmatch).
  `lighthouserc.json` / CI workflows remain disabled behind repo variables.

## Not invented (by design)

Prices, stock, opening balances, licence/tax numbers, emails, opening hours, reviews, ratings,
farmer/customer/supplier names, maund value, bag sizes, and any government/bank/JazzCash integration.
The production catalogue starts **EMPTY** and is still empty (`zt-v2-production` returns 0 rows);
the 34-item catalogue with 9 published rates exists only in `zt-v2-staging` and the local preview DB.
Biometric data never reaches the server (WebAuthn public keys only).

## Platform limits stated plainly

* **No `.apk`.** A signed Android package needs the Android SDK + Gradle, which are not installed here
  and would be a second build system. The installable route shipped instead: `manifest.webmanifest`
  (icons, `display_override`, shortcuts to `/erp/sales`, `/products`, `/checkout`) + a service worker
  (`zt-shell-v4`) + safe-area bottom nav and floating actions, i.e. an installed PWA that behaves like
  a native app on Android and iOS.
* **R2 is not enabled on the account** (`10042`), so the `FILES` binding stays commented out in
  `wrangler.v2.jsonc`. Uploads and backups fall back to D1 blobs (512 KB cap) and the local dir;
  product photos are served from the bundled WebP set, not from invented storage.
* **PageSpeed 100/100 is not a switch.** Scores are measured and reported as they come out of
  Lighthouse on this machine's throttled mobile profile; see `docs/LIGHTHOUSE_REPORT.md`.
