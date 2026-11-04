/** Part 0.3 / P10 print proof: renders the REAL shipped components (PrintDocument) with the
 *  BUILT CSS and self-hosted fonts in Chromium, for all three formats, then screenshots and
 *  writes real PDFs. Content is a clearly-labelled rendering fixture — not a business record,
 *  not a real customer, price or transaction. No server-side PDF library: PDF = page.pdf().
 *  Needs the local server (npm run dev) so /fonts/*.woff2 resolve.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { PrintDocument } from '../apps/web/src/print-docs.tsx';
import type { DocumentSnapshot } from '@zt/shared';

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
const cssName = readdirSync('apps/web/dist/assets').find((f) => /^index-.*\.css$/.test(f));
if (!cssName) { console.error('build the web app first: npm run build:web'); process.exit(1); }
const css = readFileSync(path.join('apps/web/dist/assets', cssName!), 'utf8');
mkdirSync('docs/screenshots', { recursive: true });

/** Rendering fixture — deliberately marked as a test, never a business record. */
const FIXTURE: DocumentSnapshot = {
  template_version: 'zt-print-proof', document_type: 'SALE_FERTILIZER', number: 'PROOF-0001', date: '2026-11-03',
  business: {
    name_ur: 'ذیشان ٹریڈرز', name_en: 'Zeeshan Traders', location_ur: 'مقصود چوک، ضلع لیہ، پنجاب، پاکستان',
    phone1: '0307-7864722', phone2: '0345-4654722', pesticide_licence_no: 'LIC-TEST-00',
    pesticide_licence_expiry: '2027-06-30', invoice_footer: 'شکریہ — یہ صرف رینڈرنگ ثبوت ہے',
  },
  party: { name: 'جانچ کے لیے عارضی نام', phone: '0300-0000000', address: 'نمونہ پتہ — حقیقی گاہک نہیں', cnic_masked: '42301-*******-1' },
  title_ur: 'کھاد فروخت رسید — محض رینڈرنگ ثبوت',
  lines: [
    { label: 'ڈی اے پی کھاد — نمائشی سطر', qty: '2 بوری', rate: '1,000', amount_paisa: 200_000, batch: 'TEST' },
    { label: 'یوریا کھاد — اردو جوڑ: گندم، چاول، مونگی، سرسوں', qty: '1 بوری', rate: '500', amount_paisa: 50_000 },
  ],
  subtotal_paisa: 250_000, extras: [{ label: 'اشارج', amount_paisa: 10_000 }],
  total_paisa: 260_000, paid_paisa: 160_000, due_paisa: 100_000, payment_method: 'نقد',
  note: 'یہ کوئی حقیقی لین دین نہیں؛ صرف اردو ٹائپنگ اور تینوں فارمیٹ کا بصری ثبوت۔',
  book_code: 'FERT', provisional: true,
  arithmetic: ['gross: 200 kg', 'tare: 5 kg x 2', 'net: 190 kg', '1 maund = 40 kg -> 4.75 maund'],
  // A posted document carries its server ULID; the printed QR encodes /verify/<doc_id>. The proof
  // therefore renders a live-looking symbol, not a placeholder (the code is a fixture, not a record).
  doc_id: '01HCXQ7Z3M9K2V5N8PQRSTVWXY',
};

const FORMATS: { size: string; cls: string; paper: { format?: string; width?: string; height?: string } }[] = [
  { size: 'A4', cls: 'print-a4', paper: { format: 'A4' } },
  { size: 'A5', cls: 'print-a5', paper: { format: 'A5' } },
  { size: '80mm', cls: 'print-80mm', paper: { width: '80mm', height: '120mm' } },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900, mobile: false, ua: undefined },
  { name: 'android-emulated', width: 390, height: 844, mobile: true,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
];

function pageHtml(f: (typeof FORMATS)[number]) {
  const markup = renderToStaticMarkup(React.createElement(PrintDocument, { snapshot: FIXTURE, size: f.size }));
  return `<!doctype html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="print-root" style="position:static;background:#fff;padding:0;overflow:visible">
<div class="print-bar no-print">format bar</div><div class="print-note no-print">notes</div>${markup}</div></body></html>`;
}

const rows: any[] = [];
for (const vp of VIEWPORTS) {
  const browser = await launchBrowser();
  try {
    for (const f of FORMATS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, locale: 'ur-PK', ...(vp.ua ? { userAgent: vp.ua } : {}) });
      const page = await context.newPage();
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.setContent(pageHtml(f), { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.fonts.ready);
      const probe = await page.evaluate(() => {
        const name = document.querySelector('.p-name');
        const doc = document.querySelector('.print-doc');
        const bar = document.querySelector('.print-bar');
        return {
          nastaliq: document.fonts.check('700 26px "Noto Nastaliq Urdu"'),
          naskh: document.fonts.check('400 14px "Noto Naskh Arabic"'),
          width: name?.getBoundingClientRect().width ?? 0,
          text: name?.textContent ?? '',
          hasDoc: !!doc && doc.className.includes('print-'),
          th: document.querySelectorAll('.print-doc th').length,
          thermalLines: document.querySelectorAll('.print-doc .t-line').length,
          dot: document.querySelectorAll('.print-doc .t-dot').length,
          barHiddenInPrint: !!bar && getComputedStyle(bar).display === 'none',
          overflowX: doc ? doc.scrollWidth > (doc.clientWidth + 2) : false,
          qr: document.querySelectorAll('.print-doc .zt-qr img').length,
          qrSrc: (document.querySelector('.print-doc .zt-qr img') as HTMLImageElement | null)?.src.slice(0, 24) ?? '',
        };
      });
      const jpg = `docs/screenshots/urdu-print-${f.size.toLowerCase()}-${vp.name}.jpg`;
      await page.screenshot({ path: jpg, type: 'jpeg', quality: 78, fullPage: true });
      if (vp.name === 'desktop') {
        const pdf = `docs/screenshots/urdu-invoice-${f.size.toLowerCase()}.pdf`;
        await page.pdf({ path: pdf, printBackground: true, ...(f.paper.format ? { format: f.paper.format } : { width: f.paper.width, height: f.paper.height }) });
        probe.pdf = pdf;
      }
      probe.format = f.size; probe.viewport = vp.name; probe.screenshot = jpg;
      probe.size = `${vp.width}x${vp.height}`;
      rows.push(probe);
      console.log(`${f.size}/${vp.name}: nastaliq=${probe.nastaliq} naskh=${probe.naskh} name=${Math.round(probe.width)}px thermal=${probe.thermalLines} th=${probe.th} qr=${probe.qr} overflowX=${probe.overflowX} -> ${jpg}`);
      await context.close();
    }
  } finally { await browser.close(); }
}

const ok = rows.every((r) => r.nastaliq && r.naskh && r.width > 100 && r.hasDoc && !r.overflowX && r.barHiddenInPrint)
  && rows.filter((r) => r.format === '80mm').every((r) => r.thermalLines >= 5 && r.dot >= 4 && r.th === 0)
  && rows.filter((r) => r.format === 'A5').every((r) => r.th === 4)
  && rows.filter((r) => r.format === 'A4').every((r) => r.th === 5)
  // Scan-to-verify QR: printed on A4 and 80 mm, deliberately absent from A5.
  && rows.filter((r) => r.format === 'A4' || r.format === '80mm').every((r) => r.qr === 1)
  && rows.filter((r) => r.format === 'A5').every((r) => r.qr === 0);
const missing = rows.filter((r) => !(r.nastaliq && r.naskh && r.width > 100 && r.hasDoc && !r.overflowX)).map((r) => `${r.format}/${r.viewport}`);

writeFileSync('docs/PRINT_PROOF.md', `# URDU PRINT / PDF PROOF — real browser rendering of the shipped components

Date: ${new Date().toISOString()} · Chromium headless · built CSS \`${cssName}\` · self-hosted WOFF2 fonts.
The markup is produced by **renderToStaticMarkup(PrintDocument)** — the same component the ERP preview and
\`window.print()\` use — so every format below is the real template, not a hand-written copy.
Content is a **rendering fixture** (title and note say so): no real customer, price, ledger or transaction.
No server-side PDF library: PDF = Chromium \`page.pdf()\` (browser Print -> Save as PDF).

| Format | Viewport | Nastaliq | Naskh | Header width | Thermal rows | Table headers | Verify QR | Horizontal overflow | Bar hidden | Screenshot | PDF |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.format} | ${r.viewport} (${r.size}) | ${r.nastaliq} | ${r.naskh} | ${Math.round(r.width)} px | ${r.thermalLines} | ${r.th} | ${r.qr} | ${r.overflowX ? 'YES' : 'no'} | ${r.barHiddenInPrint} | \`${r.screenshot}\` | \`${r.pdf ?? '—'}\` |`).join('\n')}

Checks: A4 keeps the 5-column table (\`#\`/تفصیل/تعداد/ریٹ/رقم), A5 the 4-column one (no line numbers),
80 mm has no table at all — only \`t-line\` rows separated by \`t-dot\` — and the sticky \`no-print\` bar plus
its notes are hidden in print media. No format overflows horizontally at 390 px.
The scan-to-verify QR is rendered exactly once on **A4** and **80 mm** (the two formats the owner
asked for) and is deliberately **absent from A5**. It is a synchronous 1-bit PNG data URL, so it
survives \`renderToStaticMarkup\` and prints crisp; \`doc_id\` is omitted on provisional snapshots,
in which case no QR is drawn rather than a made-up code.

**Result: ${ok ? 'PASS' : 'FAIL'}**${missing.length ? ` — failing: ${missing.join(', ')}` : ''}
**INCOMPLETE:** a *physical* Android Chrome screenshot was not taken (only Android Chrome emulation via
viewport + user-agent). Reprint fidelity is data-backed: each document stores its own snapshot plus
\`template_version\`, and printing reads them without touching the posted entries.
`);
console.log(`PRINT_PROOF: ${ok ? 'PASS' : 'FAIL'} (${rows.length} renderings, docs/PRINT_PROOF.md)`);
if (!ok) process.exitCode = 1;
