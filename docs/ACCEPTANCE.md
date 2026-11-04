# ACCEPTANCE LIST — A1…A20 (real results in `docs/TEST_REPORT.md`)

| Gate | Requirement | Automated evidence | Result |
|---|---|---|---|
| A1 | One-time setup creates owner, cannot re-run; unauthenticated 403/401 | `tests/integration.test.ts` A1/H5; `tests/routes.test.ts`; `tests/app-security.test.ts` unauthenticated private reads | PASS |
| A2 | Publish / unpublish + cache purge appears/disappears on public site | `tests/integration.test.ts` A2; `tests/security-gates.test.ts` HIT→purge | PASS |
| A3 | Public raw JSON never exposes cost, margin, supplier, exact stock, customers, notes | A3/H6 | PASS |
| A4 | CSV import previews without writes, then confirms with duplicate handling | A4 | PASS |
| A5 | Purchase partly paid from Meezan: stock up, payable correct, bank down | A5 | PASS |
| A6 | Credit sale posts COGS at weighted average; later receipt adds NO extra revenue | A6 | PASS |
| A7 | Expired pesticide batch hard-blocked; legal sale register queryable | A7 | PASS |
| A8 | Seven crops: net-weight arithmetic, sale, lot balance, farmer payment isolated | A8 | PASS |
| A9 | Five other goods books post independently with own stock/profit | A9 | PASS |
| A10 | Four money books separate; transfers not income/expense; fees are expenses | A10 | PASS |
| A11 | Party, book and money-book ledgers agree; statements render from snapshots | A11 | PASS |
| A12 | Expense, shop expense, payroll post; duplicate salary blocked | A12 | PASS |
| A13 | Trial balance balances; balance sheet balances; P&L per book | A13 | PASS |
| A14 | Offline push is idempotent; insufficient stock becomes a flagged CONFLICT | A14 | PASS |
| A15 | Passkey enrol / login / revoke | `tests/passkeys.test.ts` (4) + `scripts/e2e-passkeys.mjs` real Chromium virtual authenticator → `A15_E2E_PASS`; revoke → `401 PASSKEY_NOT_FOUND`; password fallback works | **PASS (local)** — real phone/security key not tested |
| A16 | Encrypted backup + **staging** restore test | A18 encrypted backup; `scripts/restore.ts` local staging-equivalent restore 1032 rows, FK + journal PASS | **PARTIAL** — real Cloudflare staging D1 restore NOT run |
| A17 | Dashboard totals = document totals = party-ledger sums | A17 | PASS |
| A18 | Usage meter + encrypted backup + integrity | A18 | PASS |
| A19 | Quota/cache behaviour (70 % warning, 60–300 s public cache, purge) | `tests/security-gates.test.ts`: 200 public hits → `rows_read=1 public_hits=200 cached_hits=199`; publish/unpublish HIT→purge | **PASS (local)** — live Cloudflare edge cache unverified |
| A20 | IDOR / SQLi / XSS | `tests/integration.test.ts` A20/A1(b); `tests/security-gates.test.ts` 24 AUDITOR writes; `tests/app-security.test.ts` 29 CSRF routes + private-read deny matrix + SQLi payloads + stored-XSS sanitisation | **PASS for the tested cases** — a full route-by-route IDOR matrix with real cross-tenant data is not automated |

**Additional gates:** 14 unit tests (H1/H4/security primitives), 4 route-matrix tests, `npm run typecheck`
(0 errors), `npm run query:plan` (15/15), `npm run build:web`, real Chromium axe (0 violations on 8 pages),
Lighthouse mobile (100/100/100 on 3 pages), 44 visual baselines with 0 % drift, Urdu print/PDF proof
(desktop + Android-emulated), Wrangler v2 staging/production dry-runs (exit 0).

`npm run check:all` → **7 test files / 54 tests passing**, exit 0.

**Still not a 100 % / all-A1–A20 claim:** A16 is PARTIAL, A19/A15 are verified locally only, and the
Part 9.3 definition of done also requires staging + production deployment with real URLs, which is
**INCOMPLETE**. See `docs/KNOWN_LIMITATIONS.md` and `/erp/status`.
