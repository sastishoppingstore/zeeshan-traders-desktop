/** Part 9.1 performance gate: real Lighthouse mobile run against the local preview.
 *  Scores are reported exactly as measured — never rounded up or claimed as targets met.
 *  The browser is the machine's own Chromium when it exists (this ARM box cannot exec the bundled
 *  x86 build), and the audited product page uses a real published item — no fixture data is written.
 */
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from './browser.mjs';

const lighthouseVersion = createRequire(import.meta.url)('lighthouse/package.json').version;

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
const NATIVE_CHROME = [process.env.ZT_CHROME, process.env.CHROME_PATH].find(Boolean)
  ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => existsSync(p));

let chromePath = NATIVE_CHROME;
if (!chromePath) {
  // No system browser: inflate the bundled build and point the launcher at it through its libs.
  const probe = await launchBrowser();
  await probe.close();
  process.env.LD_LIBRARY_PATH = '/tmp/al2023/lib';
  process.env.FONTCONFIG_PATH = '/tmp/fonts';
  process.env.HOME = '/tmp';
  chromePath = '/tmp/chromium';
}
const browserVersion = (() => {
  try { return execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim(); } catch { return chromePath; }
})();
console.log(`chrome: ${chromePath} (${browserVersion})`);

// The product-page audit needs one published item; the catalogue already carries it, so nothing is created.
const catalogue = await fetch(`${BASE}/api/v1/public/products?limit=1`).then((r) => r.json()).catch(() => null);
const slug = catalogue?.data?.rows?.[0]?.slug ?? '';
const targets = [
  { label: '/', url: `${BASE}/` },
  { label: '/products', url: `${BASE}/products` },
];
if (slug) targets.push({ label: '/product/:slug', url: `${BASE}/product/${slug}` });
else console.log('warning: no published product in this database — /product/:slug skipped');
console.log(`audit_product: ${slug || 'none'}`);

const chrome = await chromeLauncher.launch({
  chromePath,
  chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
});
const results = [];
try {
  for (const t of targets) {
    const runner = await lighthouse(t.url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'seo'],
      formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false },
    }, {
      extends: 'lighthouse:default',
      settings: { skipAudits: ['uses-http2', 'uses-long-cache-ttl'] },
    });
    writeFileSync(`.dev/lhr-${t.label.replace(/[^a-z0-9]/gi, '_')}.json`, runner.report);
    const lhr = JSON.parse(runner.report);
    const scores = {
      performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
      seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
    };
    const metrics = {
      LCP: lhr.audits['largest-contentful-paint']?.displayValue ?? '-',
      CLS: lhr.audits['cumulative-layout-shift']?.displayValue ?? '-',
      TBT: lhr.audits['total-blocking-time']?.displayValue ?? '-',
    };
    results.push({ page: t.label, url: t.url, ...scores, ...metrics });
    console.log(`${t.label.padEnd(16)} perf=${scores.performance} a11y=${scores.accessibility} seo=${scores.seo} LCP=${metrics.LCP} CLS=${metrics.CLS} TBT=${metrics.TBT}`);
  }
} finally {
  await chrome.kill();
}
writeFileSync('.dev/lighthouse.json', JSON.stringify(results, null, 2));
const targetsMet = results.every(r => r.performance >= 85 && r.accessibility >= 95 && r.seo >= 95);
writeFileSync('docs/LIGHTHOUSE_REPORT.md', `# LIGHTHOUSE REPORT — real mobile run

Date: ${new Date().toISOString()} · Lighthouse ${lighthouseVersion} · ${browserVersion} headless · mobile (390×844) · URL: ${BASE}
Targets from Part 9.1: Performance ≥ 85, Accessibility ≥ 95, SEO ≥ 95.

| Page | Perf | A11y | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|
${results.map(r => `| ${r.page} | ${r.performance} | ${r.accessibility} | ${r.seo} | ${r.LCP} | ${r.CLS} | ${r.TBT} |`).join('\n')}

**All three targets met on all three pages: ${targetsMet ? 'YES' : 'NO'}**

Scores are raw Lighthouse output, not adjusted. Raw JSON: \`.dev/lighthouse.json\`.
`);
console.log(`LIGHTHOUSE_TARGETS_MET: ${targetsMet ? 'YES' : 'NO'}`);
