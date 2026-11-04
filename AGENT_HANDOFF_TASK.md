# AGENT HANDOFF — Zeeshan Traders (zt-v2) ko mukammal kar ke Cloudflare par deploy karna

**Aap ka kaam:** is file ko poora parhein, phir **T1 → T9** tasks tarteeb se khatam karein, har gate ka **asli output** paste karein, aur aakhir me staging + production par deploy kar ke live URLs verify karein.
**Project path:** `/home/wafa-tech/trade-main`
**Aaj ki date:** 2026-11-04

---

## 0. DO NOT TOUCH — sab se pehle yeh samjhein

Yeh projects **already live** hain. In ke folder, DB, Worker, D1, R2, domain, config — **kisii shakal me mat chhedein**. Na read-only ke liye `wrangler` commands in par chalayein, na in ke naam se kuch import karein:

```
ai-agent-api          bright-future-school      candeur-diag
petrol-pump-erp       qjh-api                   qureshi-job-hunter
school_erp_db         qjh_db                    ai_agent_db
petrol_pump_erp_db
```

Hamara project sirf **`zt-v2-*`** prefix wala hai (Worker `zt-v2-staging` / `zt-v2-production`, D1 `zt-v2-staging` / `zt-v2-production`, workers.dev subdomain `sastishopping-store`). Har `wrangler` command me **`-c wrangler.v2.jsonc`** lazmi hai — agar aap bhool gaye to wrangler galti se doosre project ki config utha sakta hai.

**Sandbox/scratch files kabhi repo ke bahar** (`/tmp/...`), project folder me nahi.

---

## 1. MACHINE CONSTRAINT — ek waqt me ek process (RAM)

Machine par 2.7 GB RAM hai aur is session me **~130 MB free / ~523 MB available** dekha gaya. User ne saaf kaha: *"single single agent hi chalao, ram kam ha is liye system hang ho jay ga, parallel nhi chalao"*.

Is ka matlab:
- **Ek waqt me ek** heavy command: `typecheck` **phir** `test` **phir** `build:web` **phir** `deploy`. Inhe `&&` se chain karein to theek hai (sequential hai), **parallel tool calls / background builds ek saath mat chalayein**.
- `npx tsc --noEmit` aur `vite build` **120 s se zyada** lete hain — foreground timeout aane par **background me daalein aur result ka intezaar karein**, dobara doosra build start na karein.
- Vitest `pool: 'forks'` — `vitest run` chalayein, `--watch` nahi. Browser-based suites (`test:visual`, `test:lighthouse`, `e2e:*`) **build khatam hone ke baad**, akele akele.
- `npm run test:browser` poora chain **last me** chalayein, beech me nahi.

---

## 2. CLOUDFLARE CREDENTIALS — kahan hain, kaise use hain

**KABHI bhi secret ko command output, log, chat, ya repo file me mat likhein.** `echo "$CLOUDFLARE_API_TOKEN"` **mana hai**. Token ko hamesha variable me bhejein, print na karein.

| Cheez | Value | Kahan se load hoti hai |
|---|---|---|
| Account ID (non-secret) | `f820a41ba70d045e1736cc12c9229ce0` | `~/.cf_v2_account` (0600) |
| API Token (SECRET) | chat me paste ho chuka hai | `~/.cf_v2_token` (0600) |
| R2 access key / secret (SECRET) | chat me paste ho chuka hai | `~/.zt_v2_secrets.json` (0600) |
| Workers env vars | `ENVIRONMENT`, `DEFAULT_LANG=ur`, `TIMEZONE=Asia/Karachi`, `CURRENCY=PKR` | `wrangler.v2.jsonc` |

Deploy se pehle (har naye shell me):

```bash
cd /home/wafa-tech/trade-main
export CLOUDFLARE_ACCOUNT_ID="$(cat ~/.cf_v2_account)"
export CLOUDFLARE_API_TOKEN="$(cat ~/.cf_v2_token)"
wrangler whoami -c wrangler.v2.jsonc --env staging   # identity confirm, token value print na karein
```

⚠️ **Zaroori note (user ko dobara batayein):** yeh token/R2 keys chat me paste ho chuke hain, is liye **exposed** samjhein aur Cloudflare dashboard se **rotate** karein. Rotate karne ke baad `~/.cf_v2_token` aur `~/.zt_v2_secrets.json` update karein. Rotate na karke deploy karna theek hai, lekin reporting me yeh warning lazmi dohrayein.

**Secrets (worker bindings)** repo me nahi hain. Set karne ka tareeqa (values kabhi command line par na likhein, interactive `wrangler secret put` use karein):

```bash
wrangler secret put SESSION_SECRET -c wrangler.v2.jsonc --env staging
wrangler secret put WEBHOOK_SECRET -c wrangler.v2.jsonc --env production
```

Names `wrangler.v2.jsonc` ke aakhir me comment me mojood hain (`// Secrets (names only ...)`).

---

## 3. HAAL (2026-11-04 ko verify kiya gaya) — kya ban chuka hai

DONE (code likha hua hai, **build/test/deploy abhi pending**):

- 16 products home page + baqi products page (`apps/web/src/pages/home.tsx`, `pages/products.tsx`)
- 2-up product card par **Order Now** + **WhatsApp**
- Hero cube = asli solid 3D box, mouse lag aur scroll fix
- 3D category cards, 3D product cards par Order Now (home + products)
- Full i18n: English me sab English (site title samet), Urdu me sab Urdu — `packages/shared/src/i18n.ts:4` (`DICT`), `:280` (`tr`), `:284` (`dirFor`)
- **QR encoder** `packages/shared/src/qr.ts` — dependency-free ISO/IEC 18004, byte mode, versions 1–15, level M/L, GF(256) Reed–Solomon, 8-mask penalty search, format/version info, plus **1-bit PNG writer** (`qrPngBytes`, `qrDataUrl`). segno 1.6.6 ke reference matrices se **byte-for-byte** match karta hai (capacity-exact payloads, 15 versions × 8 masks). Export: `packages/shared/src/index.ts` me `export * from './qr.js';`
- Golden vectors: `tests/fixtures/qr-vectors.json` (33 vectors) + `tests/qr.test.ts`
- Print surface: `apps/web/src/print-docs.tsx` — `FullDoc` (A4, line 13), `CompactDoc` (A5, line 75), `ThermalDoc` (80 mm, line 116), entry `PrintDocument` (line 154). Logo/header/footer maujood.

**NAHI hua (aap ka kaam)** — grep se confirm, abhi **zero** wiring:
- `doc_id` snapshot me nahi hai
- public verify endpoint nahi
- `/verify/:id` page nahi
- A4/thermal print me QR nahi (`print-docs.tsx` me `qrDataUrl` ka koi use nahi)
- checkout beautification, ERP design pass, invoice selector
- **is round ka kuch bhi deploy nahi hua**

---

## 4. TASKS — tarteeb se, ek-ek kar ke

### T1 — QR ko data se jora (worker side)

**1a. Snapshot me `doc_id`**
`packages/shared/src/types.ts:38-61` me `interface DocumentSnapshot` par optional field add karein:

```ts
doc_id?: string;   // server document ULID; present only for posted documents
```

`apps/worker/src/posting.ts:204-212` — `Posting.document()` ab `ulid()` INSERT ke andar inline banata hai, is liye snapshot us se pehle serialize ho jata hai. **Hoist** karein:

```ts
document(input: { ... }): void {
  const id = ulid();
  const snapshot = { ...input.snapshot, doc_id: input.snapshot.doc_id ?? id };
  this.b.add(`INSERT INTO documents (...) VALUES (...)`,
    id, input.type, input.number, input.party_id, this.date, input.amount_paisa,
    input.book_code ?? null, input.ref_id, JSON.stringify(snapshot), TEMPLATE_VERSION, this.at, this.actor.id);
}
```

`Posting.document()` **synchronous** hai — WebCrypto async hai, is liye HMAC token **mat** banayein; `documents.id` (26-char ULID, `crypto.getRandomValues` se) hi capability hai. 11 call sites hain, sab ko chhedne ki zaroorat nahi — sirf yeh ek jagah.

**1b. Public verify endpoint** (whitelist — poora snapshot KABHI na dein)

`apps/worker/src/routes/reports.ts` me (`:290` wale `/api/v1/documents` ke qareeb) add karein:

```ts
// Public: owner scans the QR on a printed invoice and lands on a read-only
// verification page. Whitelist only — never cost, margin, exact stock,
// supplier, ledger balances, party phone/address/CNIC.
app.get('/api/v1/public/invoice/:id', (c) => handle(c, async () => {
  const db = makeDb(c);
  const ip = clientIp(c);
  const rl = await rateLimit(db, `invoice-verify:${ip}`, 60, 60_000);
  if (!rl.ok) return fail(c, 429, 'RATE_LIMITED', 'Too many verification requests.');
  const row = await db.prepare('SELECT id,type,number,date,amount_paisa,snapshot_json,template_version FROM documents WHERE id=?')
    .bind(c.req.param('id')).first<any>();
  if (!row) return fail(c, 404, 'NOT_FOUND', 'Invoice not found in this business.');
  const s = JSON.parse(row.snapshot_json);
  return ok(c, {
    verified: true, number: row.number, type: row.type, date: row.date,
    amount_paisa: row.amount_paisa, currency: 'PKR', template_version: row.template_version,
    business_name: s.business?.name ?? null, party_name: s.party?.name ?? null,
    issued_at: s.issued_at ?? null, total_label: s.total_label ?? null,
    lines: (s.lines ?? []).map((l: any) => ({ label: l.label, qty: l.qty, unit: l.unit, rate_paisa: l.rate_paisa, amount_paisa: l.amount_paisa })),
  });
}));
```

**Ese pattern pehle check karein** — `apps/worker/src/routes/checkout.ts:63-148` me public GET + `rateLimit` + `clientIp` + `fail(c,404,'NOT_FOUND',…)` ki maujooda misaal hai; `makeDb`/`requirePerm`/`fail`/`ok` `./context.js` se aate hain. Helpers ke asli signatures padh kar matching code likhein — upar ka snippet **shape** dikhata hai, exact naam copy na karein agar checkout.ts alag hai.

`apps/worker/src/app.ts:63` already `/api/v1/public/` prefix ko auth se bachaata hai — **koi aur change wahan na karein**, sirf confirm karein ke route register hone se pehle yeh check hai (reports module `registerReports(app)` ke andar ho to theek).

**1c. `/verify/:id` public SPA page**
`apps/web/src/public.tsx` me routing `<Route path="..." element={...} />` style me hai (`:235-238`). Add karein:

```tsx
<Route path="/verify/:id" element={<InvoiceVerify />} />
```

`InvoiceVerify` naya component (same file ya `apps/web/src/pages/verify.tsx` — project convention dekh kar) jo:
- `fetch('/api/v1/public/invoice/' + id)` kare, `loading` (skeleton) / `success` / `404 error` / `empty` **charon states** dikhaye
- Urdu + English dono (`tr('verify…', lang)`) — RTL `dirFor(lang)` ke mutabiq
- Amount paisa se rupees format (existing money helper use karein, `toFixed` math **na** karein)
- Kuch bhi editable **na** ho — read-only verification card
- i18n keys `packages/shared/src/i18n.ts` `DICT` me add karein (`ur` **aur** `en` dono), jaise `scanQrHint`

### T2 — QR print templates me (A4 **aur** 80 mm — user ne 2 par zor diya)

`apps/web/src/print-docs.tsx`:

```tsx
import { qrDataUrl } from '@zt/shared';

// FullDoc (A4) footer ke qareeb, aur ThermalDoc (80mm) ke aakhir me:
{ s.doc_id && (
  <div className="zt-qr">
    <img src={qrDataUrl(`https://zt.sastishopping-store.workers.dev/verify/${s.doc_id}`, { scale: 4, quiet: 4 })}
         width={84} height={84} alt="Verify this invoice" />
    <p>{tr('scanQrHint', s.lang ?? 'ur')}</p>
  </div>
)}
```

⚠️ **Har bari naya URL mat ghusayein** — pehle `docs/ROUTE_MAP.md` aur existing code me dekhein ke full absolute URL kaise banta hai (thermal/A4 templates me abhi kya use hota hai). Agar koi `origin`/`baseUrl` prop ya `window.location.origin` pattern already hai to wahi use karein; print proof `renderToStaticMarkup` me chalta hai jahan `window` NAHI hota — is liye QR **synchronous** hona chahiye (hamara `qrDataUrl` hai) aur URL ek **constant** se aana chahiye. `docs/PRINT_PROOF.md` paratchheen karein.
- `doc_id` na ho (client-side provisional snapshots: `apps/web/src/erpForms.tsx:236,390,463` aur legacy rows) → **QR chhod dein, crash na ho**. Yeh intentional graceful degradation hai.
- CSS classes `apps/web/src/styles.css` ke print section me add karein. `@media print` me `break-inside: avoid` aur thermal ke liye 80 mm width ka khayal.
- No SVG, no npm dep — PNG data URL hi chalega.

### T3 — Checkout page khoobsurat (`apps/web/src/pages/checkout.tsx`)
Payment proof upload flow, steps clearly numbered, emerald/gold/pink palette, RTL, 360 px se 1536 px tak koi horizontal overflow nahi. **Function tootna nahi chahiye** — `checkout-ready`, payment-approval, upload — sab pehle jaise chal rahe hain, sirf visual/UX pass.

### T4 — ERP design pass + invoice selector
- `apps/web/src/erpScreens.tsx` — `DocumentsCentre` (~line 610-650): `<Sheet>` + `<PrintActions snapshot={selected.snapshot} />` (line ~639) + raw JSON `<pre>`. Is screen par **invoice selector** add karein: invoice list se select karein, selected ka preview/print size (A4/A5/80 mm) badlein. `apps/web/src/print.tsx` me `PrintActions` portal + size chips already hain (abhi Urdu-only literals — i18n keys bana kar `tr()` se layein).
- Abhi `<pre>{JSON.stringify(...)}</pre>` developer-ish hai — usse structured summary me badlein ya secondary toggle ke peeche daalein.
- Baqi ERP screens par consistent spacing/typography/state (loading/empty/error) polish. Naya npm dependency **nahi**.

### T5 — A4 invoice "3D khubsurt"
Logo, header, footer already mojood hain (`print-docs.tsx:13` `FullDoc`). Depth/emboss **CSS-only** (shadows, gradients, `transform`) — lekin **thermal/A4 print proof me QR aur text ka contrast** kam na ho. `test:print` ke screenshots se pehle/baad compare karein.

### T6 — Verification gates (sab lazmi, output paste karein)
Ek-ek kar ke:

```bash
cd /home/wafa-tech/trade-main
npm run typecheck          # 0 errors
npm test                   # all pass (qr.test.ts includes 33 vectors)
npm run build:web          # exit 0, apps/web/dist fresh
npm run test:print         # A4/A5/80mm proof, QR visible on A4 + 80mm
npm run test:visual        # pixelprint baselines
npm run test:a11y
npm run query:plan
```

**Lighthouse (T6.1):** pichhli run **fail** thi — `/` perf 25, `/products` sab metrics `-` (audit errored), `/product/:slug` perf 12 with CLS 0.947, `LIGHTHOUSE_TARGETS_MET: NO`. `docs/LIGHTHOUSE_REPORT.md` refresh karein aur **asli numbers** dein. User ka target 100 hai; agar hasil nahi hua to **jhoot na bolein** — cause likhein (CLS ka culprit dhoondein: cube/hero transform, image dimensions missing, lazy chunk) aur improve karein. Dobara run:

```bash
npm run test:lighthouse
```

### T7 — Deploy staging

```bash
cd /home/wafa-tech/trade-main
export CLOUDFLARE_ACCOUNT_ID="$(cat ~/.cf_v2_account)"
export CLOUDFLARE_API_TOKEN="$(cat ~/.cf_v2_token)"
npm run deploy:dryrun            # exit 0
npm run deploy:staging           # exit 0 → https://zt-v2-staging.sastishopping-store.workers.dev
```

DB **reset nahi** karna. Sirf agar naya migration file likha hai:

```bash
npm run d1:staging               # wrangler d1 migrations apply zt-v2-staging --remote
```

`T1` me koi schema change nahi hai (snapshot_json ke andar `doc_id`), is liye migration ki zaroorat honi chahiye hi nahi — agar koi agent naye column ka lalach de to ruk jayein.

Staging smoke (har check ka output paste karein):

```bash
curl -sS -o /dev/null -w 'home %{http_code}\n' https://zt-v2-staging.sastishopping-store.workers.dev/
curl -sS -o /dev/null -w 'products %{http_code}\n' https://zt-v2-staging.sastishopping-store.workers.dev/products
curl -sS https://zt-v2-staging.sastishopping-store.workers.dev/api/v1/public/invoice/00000000000000000000000000 | head -c 300
# expected: 404 NOT_FOUND JSON, no stack trace, no secrets
curl -sS -o /dev/null -w 'verify page %{http_code}\n' https://zt-v2-staging.sastishopping-store.workers.dev/verify/00000000000000000000000000
```

### T8 — Deploy production

Sirf T7 green ho:

```bash
npm run deploy:production        # → https://zt-v2.sastishopping-store.workers.dev
npm run d1:production            # only if a new migration exists
```

Production smoke wahi commands `zt-v2.` host par. **`EXPOSE_SETUP_TOKEN` kabhi enable na karein.**

### T9 — Live QR proof (end-to-end)
Staging/production par login → invoice banayein/post karein → uska `doc_id` nikalein → browser me `/verify/<id>` kholen → 200 + verified data. Phir print preview ka screenshot lein jisme **A4 aur 80 mm dono** par QR dikhe. Scan kar ke dikhane ke liye: is sandbox ke Chromium me `BarcodeDetector` **available: false** tha, is liye ya to ` segno`/`pyzbar` se offline decode karein (dev-only, `/tmp` me) ya phone se scan karne ki instruction user ko dein — **proof ke bina "verified" na kahein**.

---

## 5. MAMNOAT (jitni baar bhi kisi ne koshish ki, tabah)

- Fake production products / fake APIs / hardcoded prices-balances — **production catalogue EMPTY hi start hota hai**
- localStorage se D1 replace karna, DB reset, field rename/remove
- Public JSON me `cost`, `margin`, exact `stock`, supplier, customer phone/address/CNIC, ledger balances
- Naye npm dependencies, emoji, SVG
- Purane live projects ko chhoona
- Bina actual command output ke "tests pass" / "deploy ho gaya" kehna

---

## 6. ENVIRONMENT GOTCHAS (waqt bachane ke liye)

1. `tsc --noEmit` aur `vite build` > 2 min — background me daal kar **intezaar** karein, doosra parallel build **nahi**.
2. `tests/qr.test.ts` ke vectors segno se bane hain. segno byte-aligned payload par ek extra `0x00` pad codeword likhta hai; ISO 7.4.9/7.4.10 aur zxing boundary par rukte hain. **Yeh hamara bug nahi** — test isi liye capacity-exact payloads pin karta hai.
3. QR PNG **1-bit greyscale inverted** hai: sample 0 = black ink, 1 = white paper. Bit light modules ke liye set karein (`print-docs`/`qr.ts` me comment mojood hai).
4. `renderToStaticMarkup` (print proof) me effects/canvas/document nahi chalte — QR is liye synchronous PNG data URL hai.
5. `BarcodeDetector` sandbox Chromium me nahi.
6. Node 22.23.2, Linux arm64. Chrome/playwright-core installed hai; `npm install` nayi cheezon ke liye **mat** karein.
7. `wrangler.v2.jsonc` me `r2_buckets` lines **commented** hain — R2 abhi owner ne enable nahi kiya (error 10042). Un comment na karein.

---

## 7. REPORTING FORMAT (aakhir me exactly yeh dein)

```
T1  doc_id + public endpoint + /verify page  : PASS/FAIL  + files changed (path:line) + curl output
T2  QR on A4 + 80mm                          : PASS/FAIL  + print proof paths
T3  checkout                                 : PASS/FAIL
T4  ERP + invoice selector                   : PASS/FAIL
T5  A4 visual                                : PASS/FAIL
T6  typecheck/test/build/print/visual/a11y   : har command ka exit code + tail output
    lighthouse                               : asli scores (target 100, agar kam hai to kyun)
T7  staging deploy                           : wrangler tail + smoke HTTP codes + URL
T8  production deploy                        : wrangler tail + smoke HTTP codes + URL
T9  live verify + scan proof                 : kya prove hua, kya nahi
BLOCKERS                                   : owner se kya chahiye
```

**Owner se abhi poochhna baqi:**
1. `1 من = ? kg` (PUB measurement conversion — seed/catalogue ke liye)
2. R2 enable karein (image upload + backups abhi local-only)
3. Custom domain chahiye ya `*.workers.dev` hi rahe
4. Cloudflare token/R2 keys **rotate** karein (chat me paste ho chuke)

---

## 8. Pehle ka kaam dohrana NAHI

Master prompt (1107 lines) ke items 1–9 already implement ho chuke hain — un par dobara design rewrite na karein, sirf regressions check karein. Aap ka focus **T1 → T9** hai, khaas tor par **QR verify chain** jo abhi bilkul nahi hai, aur phir **asli deploy**.
