# Zeeshan Traders — Desktop (offline-first)

The Windows desktop build of the Zeeshan Traders ERP (ذیشان ٹریڈرز). It is a real Electron
application — not a WebView around a hosted site. The UI and all business logic run on the
machine; every byte of data lives in a local SQLite file; the online Worker API is used only as a
backup and as the shared source of truth between the shop's devices.

The web app is unchanged and still serves the public catalogue and the six always-online
browsers. The desktop build is a separate, static export of the same React code — it never
touches the web pipeline.

---

## 1. What is different from the original plan

| The prompt assumed | What this repo actually is | Decision |
|---|---|---|
| Next.js + React | Vite + React (`apps/web`), Hono on Cloudflare Workers (`apps/worker`), D1 + R2 | Adapted, not rewritten. `BUILD_TARGET=desktop` selects a static Vite build (`base: './'`, `outDir: out/`). There is no `next export` step because there is no Next.js. |
| `useServerData` / server components | TanStack Query + `fetch` through `apps/web/src/api.ts` | The data-access layer is `api.ts`. It already had a desktop branch (`window.desktop`), so UI components never learn which mode they are in. |
| API routes to migrate | Already a Hono Worker with `/api/v1/*` | Reused as-is; the sync endpoints were added alongside it. |

Everything else in the prompt is implemented as written. This file records the adaptation
because the working rules asked for the safest option plus documentation, rather than stopping.

---

## 2. Architecture

```
┌──────────────────────────── Electron main process (electron/main.cjs) ─────────────────────────┐
│  BrowserWindow (sandbox, contextIsolation, no nodeIntegration)                                 │
│    └─ renderer served from a private zt-app:// scheme over <root>/out (the static export)      │
│  IPC surface (electron/preload.cjs) — the ONLY thing the renderer can reach:                    │
│    request(method, path, body) · status() · syncNow() · conflicts() · resolveConflict()        │
│    session() · outbox() · entityList() · online()                                               │
│                                                                                                 │
│  electron/rest-serve.cjs  ← every renderer API call is resolved locally or forwarded            │
│  electron/rest-map.cjs    ← the route table: row / command / replica / remote tiers             │
│  electron/db.cjs          ← local SQLite (better-sqlite3), outbox, conflict ledger, migrations  │
│  electron/sync.cjs        ← background push/pull engine (mutex, 30s tick, backoff)              │
│  electron/vault.cjs       ← Electron safeStorage (DPAPI) session vault — the only token store   │
│  electron/config.cjs      ← API origin: env > <userData>/config.json > baked out/desktop-config │
│  electron/bundle.cjs      ← static file serving + path-traversal guard for the renderer         │
│  electron/migrations.cjs  ← replays the repo's real migrations/*.sql into the local DB          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                 │  HTTPS (the only network destination; enforced by onBeforeRequest)
                 ▼
        Cloudflare Worker API  ──  /api/v1/sync/rows/push · /api/v1/sync/pull · /api/v1/health
                                 └─ D1 (server truth) + R2 (media)
```

Key files:

- `electron/main.cjs` — window, lifecycle, single-instance lock, session vault, request forwarding,
  and a `webRequest.onBeforeRequest` hook that cancels every request that is not the shop's own API.
- `electron/preload.cjs` — `contextBridge` only. No `ipcRenderer`, no `fs`, no `sqlite`, no token.
- `electron/db.cjs` — local schema (replayed from `migrations/`), row save/tombstone, outbox,
  `local_conflicts`, delta-apply, cursors.
- `electron/sync.cjs` — push-then-pull, one sync at a time, exponential backoff, status events.
- `electron/rest-serve.cjs` / `rest-map.cjs` — answers the app's `/api/v1/*` calls from SQLite when
  it can, queues writes, forwards the rest when online, and returns a clear `503 OFFLINE` when not.
- `apps/web/src/desktop.ts` — the renderer half of the IPC contract.
- `apps/web/src/desktop-sync.tsx` — the **Desktop Sync** screen (`/erp/desktop-sync`): queue,
  conflicts, manual sync, status.
- `apps/web/src/ui/sync-chip.tsx` — the header status chip.

### Local data model

Every synced table gets four extra columns on top of the server's own schema (which is replayed
verbatim, so the desktop's schema *is* the server's schema):

| column | meaning |
|---|---|
| `version` | last server version this machine knows. `0` = locally created, never pushed. |
| `updated_at` | server-assigned timestamp; the pull cursor. Never written from a client clock. |
| `synced` | `0` = pending push. A dirty row is never overwritten by an incoming pull. |
| `deleted` | soft delete. Nothing is ever hard-deleted; a tombstone propagates through pull. |

Plus `local_version` (local edit counter) and two local-only tables: `outbox` (one row per
pending intention, with `base_version`) and `local_conflicts`. Writes go through transactions and
the DB runs in WAL mode.

### Auth

The first login must happen online (the Worker issues the session). The token is lifted out of
`Set-Cookie` and written **only** through `safeStorage` (DPAPI on Windows) into
`<userData>/session.bin` — never `localStorage`, never plain text. The last successful
`GET /api/v1/auth/me` is cached in the same vault, so later launches start fully offline using the
stored session: if `/auth/me` cannot be reached, the renderer falls back to that cached session
instead of showing the login screen. An expired token keeps the app usable offline and only asks
for re-login when the server actually rejects it while online.

---

## 3. Run it locally

```bash
npm ci

# Web app (unchanged) — http://localhost:3000
npm run dev

# Desktop: build the static renderer, bake the API origin, launch Electron
DESKTOP_API_URL=http://localhost:3000 npm run dev:desktop

# Type-check, tests
npm run typecheck
npm test                      # or: npx vitest run tests/sync.test.ts
```

The desktop talks to whatever URL you bake or export. Precedence at runtime:

1. `DESKTOP_API_URL` environment variable (developer runs),
2. `<userData>/config.json` → `{ "api_base_url": "…" }` (shop override),
3. `<appRoot>/out/desktop-config.json` (baked into the installer by CI).

Native module: `better-sqlite3` must be compiled for the Electron ABI. `npm run rebuild:native`
does that (`electron-rebuild -f -w better-sqlite3`); `electron-builder` also does it via
`npmRebuild`. Tests do **not** need it — `electron/sqlite-driver.cjs` falls back to Node's
`node:sqlite` so the queue and sync paths are testable on any CI image.

Useful Node-only checks (no GUI, no Electron):

```bash
node electron/verify-migrations.cjs   # migrations replay cleanly
node electron/verify-registry.cjs     # the CJS registry mirror matches packages/shared/src/sync.ts
```

---

## 4. Build the Windows installer

Locally (on Windows, or with Wine) — requires `DESKTOP_API_URL`:

```bash
DESKTOP_API_URL=https://<worker>.workers.dev npm run dist:win
```

`dist:win` = `build:desktop` (Vite static export to `out/`) → `write-desktop-config.mjs`
(bakes `out/desktop-config.json`; fails if the URL is missing) → `electron-builder --win nsis --x64`.
The installer lands in `dist/`.

In CI — `.github/workflows/build-desktop.yml` runs on `windows-latest`:

- One-time: GitHub → Settings → Secrets and variables → Actions → **Variables** →
  `DESKTOP_API_URL = https://<worker>.workers.dev`. This is not a secret; the origin is public and
  ends up inside the installer.
- `workflow_dispatch` → builds and uploads the `.exe` as a workflow artifact.
- Push a `v*` tag → also creates/attaches a GitHub Release with the installer.
- Steps: guard the variable → `npm ci` → cache/rebuild `better-sqlite3` → **`npm test`** → build
  `out/` → verify relative assets → bake the API origin → `electron-builder --win nsis` → assert the
  `.exe` exists → upload artifact.

The workflow needs `permissions: contents: write` (already set) to publish a Release; no PAT is used.
Code signing is off; unsigned installers trigger a SmartScreen warning until a certificate is
configured (see the placeholder note in `package.json`).

---

## 5. How sync works

Triggers: app start, connectivity regained, after each local write (debounced ~4s), and a 30s tick
while online. A real reachability probe (`GET /api/v1/health`) runs in addition to
`net.isOnline()`, because an OS can be "online" behind a captive portal.

Order is always **push, then pull**, then commands, then rows:

- **Push** (`POST /api/v1/sync/rows/push`): batches of `{ op_id, entity, id, data, base_version, deleted }`.
  The server writes inside a transaction: row absent → insert at version 1; row present and
  `version === base_version` → update, version + 1; otherwise → no write, the row comes back in
  `conflicts` with the current server copy. Only accepted rows are marked clean locally; a partial
  batch is fine. The same `op_id` replayed is idempotent — the server records the verdict and does
  not apply it twice.
- **Pull** (`GET /api/v1/sync/pull?entity=…&since=<cursor>&limit=…`): rows changed after the cursor,
  including tombstones, applied in one transaction with the cursor. Paging is supported
  (`has_more` + next cursor); a truncated full-refresh table is refused rather than replacing local
  history.
- **Commands** (sales, purchases, receipts, …) are never written as rows by the desktop — a posted
  document must be numbered and ledgered by the server. They go through the outbox as commands in
  exactly the same push, with an server-side idempotency key.

Failures on network/5xx retry with exponential backoff (5s → 10min, 12 tries, then parked). Nothing
throws out of a sync run: every failure is a status field, a log line (`<userData>/logs`) and a retry
timer. Closing, crashing or restarting the app never loses a queued change — it is in SQLite, not in
memory.

### Conflict handling (server wins, nothing is lost)

A row the server cannot accept — a stale `base_version`, or master data that arrived dirty — is
returned and the desktop:

1. keeps the local copy as-is (never clobbers a dirty row from an incoming pull),
2. stores **both** sides in `local_conflicts` (`local_data`, `server_data`, `reason`, `created_at`),
3. shows it on the **Desktop Sync** screen.

The shop chooses:

- **Keep server** — the local edit is abandoned (still recorded), the row is marked clean and takes
  the server version; the next pull brings the server's values.
- **Reapply mine** — the stashed edit is re-queued against the *current* server version, so the next
  push wins instead of colliding again.

Business rejections that are really conflicts (e.g. `INSUFFICIENT_STOCK` when an offline sale is
finally posted) land in the same ledger as a `CONFLICT`, not as an opaque `FAILED`.

The normal browser endpoints (`PUT /api/v1/products/:id`, categories, payment methods, CMS pages,
settings) use the same optimistic lock: they accept `base_version`, return `409 VERSION_CONFLICT`
with `error.current` (the row as it is now), and the web UI reloads the latest values when it sees
that response. `DELETE /api/v1/payment-methods/:id` takes `?base_version=` and soft-deletes.

---

## 6. Server migration steps

The desktop needs the sync columns and the sync endpoints on the deployed Worker. From a checkout
with Cloudflare credentials:

```bash
# 1. Review the migration (row versioning + soft delete + delta-pull indexes)
cat migrations/0006_desktop_sync.sql

# 2. Apply it to staging, then production (D1)
npx wrangler d1 migrations apply zt-v2-staging    --remote -c wrangler.v2.jsonc --env staging
npx wrangler d1 migrations apply zt-v2-production --remote -c wrangler.v2.jsonc --env production

# 3. Deploy the Worker that serves /api/v1/sync/*
npm run build:web
npx wrangler deploy -c wrangler.v2.jsonc --env staging
npx wrangler deploy -c wrangler.v2.jsonc --env production
```

Backfill is automatic: existing rows get `version = 1`, `updated_at` = their existing value (or now)
and `deleted = 0` through the migration's defaults. The full deployment runbook is in
`docs/RUNBOOK.md` / `docs/NEW_PROJECT_DEPLOY.md`.

> **The Worker must be rebuilt from this commit.** A product or category created offline has no
> slug — the slug is server-owned and `derive_slug` is applied on the row-push create path, exactly
> as `POST /products` does. On a Worker older than this commit the push is rejected with
> `NOT NULL constraint failed: products.slug`, so offline-created products never sync. Applying the
> D1 migration alone is not enough; redeploy the Worker.

Endpoints added for the desktop (all authenticated, rate-limited, input-validated):

| endpoint | purpose |
|---|---|
| `POST /api/v1/sync/rows/push` | batched row + command push with `base_version` checks |
| `GET /api/v1/sync/pull` | delta pull (`since`, `entity`, `limit`, next cursor) |
| `GET /api/v1/health` | reachability probe |
| `GET /api/v1/sync/conflicts` · `POST /api/v1/sync/conflicts/:id/resolve` | server-side conflict view for admins |

Bearer-token auth works without cookies/CSRF for the desktop; the cookie path still enforces CSRF.

---

## 7. Tests

`npm test` (vitest) covers the acceptance criteria:

- `tests/sync.test.ts` — real Worker + real SQL: push/pull, stale `base_version` → conflict, an edit
  based on the version it read, client-supplied `version`/`updated_at` ignored, soft-delete
  propagation, idempotent replay, partial-batch failure, permission gates, and that the sync
  registry covers every table in `migrations/`.
- `tests/desktop-local-sync.test.ts` — the local queue on `node:sqlite`: offline create + edit
  coalesce to one push, tombstone delete, clean pull applies, a dirty row is never overwritten and
  both copies are parked, both conflict resolutions behave, and a document queues as an intent with
  a valid `created_at`.
- `tests/desktop-online-offline.test.ts` — the seam: the real `electron/sync.cjs` and
  `electron/rest-serve.cjs` driven against the real Worker. Save offline → push → the server row and
  the local version agree; a web edit comes down on the next pull; a losing offline edit is parked,
  never clobbered; a tombstone syncs; an offline expense posts through the server engine.
- `tests/registry-drift.test.ts` — `electron/registry.cjs` is compared to
  `packages/shared/src/sync.ts` inside `npm test`, so the mirror can never silently drift (this is
  what caught `website_pages.pk`). `electron/verify-registry.cjs` is the developer's copy of the
  same gate.
- `tests/desktop-config.test.ts` — API-origin precedence (env > operator config > baked installer
  value), placeholder rejection, and no placeholder template when the installer carries an origin.
- `tests/version-guard.test.ts` — `base_version` on products/categories/settings returns
  `409 VERSION_CONFLICT` with `error.current` and writes nothing.
- `tests/integration.test.ts` — the A1–A20 acceptance scenarios, including **A14**: an idempotent
  offline push does not double-post, and an insufficient-stock offline sale becomes a `CONFLICT`.

`electron/verify-migrations.cjs` and `electron/verify-registry.cjs` gate the local schema replay and
the CJS registry mirror.

---

## 8. Known limitations

- **The first login must be online.** There is no offline first-run setup — the session has to be
  issued by the server once. After that the app is fully offline-capable.
- **Remote-tier screens need the network**: dashboards, reports, khata statements, integrity
  checks, backup and uploads are forwarded to the Worker. Offline they show a clear
  “offline / unavailable” state rather than stale numbers. Row, command and replica data (the
  catalogue, documents, balances) all work offline.
- **One desktop instance per machine.** A single-instance lock prevents two processes writing the
  same SQLite file; a second launch focuses the first window.
- **CSV exports** are available online; the desktop export path is limited by what the renderer can
  save under `file://` and falls back to the web app for some formats.
- **Unsigned installer** → SmartScreen warning on first run until a code-signing certificate is
  configured.
- The desktop build excludes the public storefront entirely (it is a separate chunk that the
  desktop bundle does not emit); the shop's public site remains the web deployment.
- `docs/`-level acceptance of the installed `.exe` (start with no internet, no external requests,
  live two-way sync) still requires a physical Windows machine — CI builds and tests the package,
  but cannot exercise a real shop counter.

---

## 9. Security notes

- The renderer has no Node, no `fs`, no SQLite and no token. It can call ten named IPC functions and
  nothing else.
- The only permitted network destination is the configured API origin; `webRequest.onBeforeRequest`
  cancels everything else, which is how “no CDN/font/image calls at runtime” is enforced rather than
  merely intended. All fonts and images are bundled locally.
- The session token lives only in the `safeStorage` vault. Logs redact token/password/secret-like
  fields (`electron/logger.cjs`).
- No secret, PAT or token is committed. The API origin is a public GitHub *variable*, not a secret;
  code signing is off with an inert placeholder.
