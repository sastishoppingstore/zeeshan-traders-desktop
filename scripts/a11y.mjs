/** Part 9.1 / A19: real axe-core 4.14 automated accessibility audit.
 *  Runs on login, product form, sale form (A19) plus the public pages.
 */
import { launchBrowser } from './browser.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const PAGES = [
  ['public-home', '/'], ['public-products', '/products'], ['public-enquiry', '/enquiry'],
  ['login', '/erp/login'], ['product-form', '/erp/products/new'],
  ['sale-form', '/erp/fertilizer/sale/new'], ['dashboard', '/erp'], ['settings', '/erp/settings'],
];
const browser = await launchBrowser();
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ur-PK' });
  const page = await context.newPage();
  // This ARM box runs Chromium with very little free RAM; first navigations can take ~45s.
  page.setDefaultNavigationTimeout(120_000);
  // CSP is `script-src 'self'`; serve axe from a same-origin URL via a route instead of inline.
  await page.route('**/__zt_axe.min.js', (route) => route.fulfill({
    status: 200, contentType: 'application/javascript', body: axeSource,
  }));
  await page.goto(`${BASE}/erp/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'e2e-owner', password: 'E2E-Test-Owner-2026!' }) });
  });
  for (const [name, path] of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(250);
    await page.addScriptTag({ url: `${BASE}/__zt_axe.min.js` });
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      });
      return {
        violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length,
          help: v.help, sample: v.nodes[0]?.target?.join(' ') ?? '' })),
        passes: r.passes.length, incomplete: r.incomplete.length,
      };
    });
    const critical = res.violations.filter(v => ['critical', 'serious'].includes(v.impact));
    results.push({ page: name, path, ...res, critical: critical.length });
    console.log(`${name.padEnd(18)} violations=${res.violations.length} critical/serious=${critical.length} axe_passes=${res.passes}`);
    for (const v of res.violations.slice(0, 6)) console.log(`   - ${v.impact} ${v.id} (${v.nodes}) ${v.sample}`);
  }
  await context.close();
} finally { await browser.close(); }

const total = results.reduce((n, r) => n + r.violations.length, 0);
writeFileSync('.dev/a11y.json', JSON.stringify(results, null, 2));
writeFileSync('docs/A11Y_REPORT.md', `# ACCESSIBILITY REPORT — axe-core 4.14 (real run)

Date: ${new Date().toISOString()} · Chromium 153 headless · 390×844 RTL ur-PK · URL: ${BASE}
Tags: wcag2a, wcag2aa, wcag21a, wcag21aa. A19 requires keyboard + screen-reader pass on login, product form and sale form.

| Page | Violations | Critical/Serious | axe passes | Incomplete |
|---|---|---|---|---|
${results.map(r => `| ${r.page} | ${r.violations.length} | ${r.critical} | ${r.passes} | ${r.incomplete} |`).join('\n')}

**Total violations: ${total}**. Raw JSON: \`.dev/a11y.json\`.

${results.flatMap(r => r.violations.map(v => `- **${r.page}** — ${v.impact} \`${v.id}\` (${v.nodes} nodes): ${v.help} · \`${v.sample}\``)).join('\n') || '- No violations detected.'}
`);
console.log(`A11Y_TOTAL_VIOLATIONS: ${total}`);
if (total > 0) process.exitCode = 1;
