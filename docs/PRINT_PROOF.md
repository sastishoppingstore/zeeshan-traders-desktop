# URDU PRINT / PDF PROOF — real browser rendering of the shipped components

Date: 2026-11-04T16:53:46.328Z · Chromium headless · built CSS `index-C3u04Sby.css` · self-hosted WOFF2 fonts.
The markup is produced by **renderToStaticMarkup(PrintDocument)** — the same component the ERP preview and
`window.print()` use — so every format below is the real template, not a hand-written copy.
Content is a **rendering fixture** (title and note say so): no real customer, price, ledger or transaction.
No server-side PDF library: PDF = Chromium `page.pdf()` (browser Print -> Save as PDF).

| Format | Viewport | Nastaliq | Naskh | Header width | Thermal rows | Table headers | Verify QR | Horizontal overflow | Bar hidden | Screenshot | PDF |
|---|---|---|---|---|---|---|---|---|---|---|
| A4 | desktop (1280x900) | true | true | 272 px | 0 | 5 | 1 | no | true | `docs/screenshots/urdu-print-a4-desktop.jpg` | `docs/screenshots/urdu-invoice-a4.pdf` |
| A5 | desktop (1280x900) | true | true | 110 px | 0 | 4 | 0 | no | true | `docs/screenshots/urdu-print-a5-desktop.jpg` | `docs/screenshots/urdu-invoice-a5.pdf` |
| 80mm | desktop (1280x900) | true | true | 295 px | 8 | 0 | 1 | no | true | `docs/screenshots/urdu-print-80mm-desktop.jpg` | `docs/screenshots/urdu-invoice-80mm.pdf` |
| A4 | android-emulated (390x844) | true | true | 150 px | 0 | 5 | 1 | no | true | `docs/screenshots/urdu-print-a4-android-emulated.jpg` | `—` |
| A5 | android-emulated (390x844) | true | true | 110 px | 0 | 4 | 0 | no | true | `docs/screenshots/urdu-print-a5-android-emulated.jpg` | `—` |
| 80mm | android-emulated (390x844) | true | true | 295 px | 8 | 0 | 1 | no | true | `docs/screenshots/urdu-print-80mm-android-emulated.jpg` | `—` |

Checks: A4 keeps the 5-column table (`#`/تفصیل/تعداد/ریٹ/رقم), A5 the 4-column one (no line numbers),
80 mm has no table at all — only `t-line` rows separated by `t-dot` — and the sticky `no-print` bar plus
its notes are hidden in print media. No format overflows horizontally at 390 px.
The scan-to-verify QR is rendered exactly once on **A4** and **80 mm** (the two formats the owner
asked for) and is deliberately **absent from A5**. It is a synchronous 1-bit PNG data URL, so it
survives `renderToStaticMarkup` and prints crisp; `doc_id` is omitted on provisional snapshots,
in which case no QR is drawn rather than a made-up code.

**Result: PASS**
**INCOMPLETE:** a *physical* Android Chrome screenshot was not taken (only Android Chrome emulation via
viewport + user-agent). Reprint fidelity is data-backed: each document stores its own snapshot plus
`template_version`, and printing reads them without touching the posted entries.
