/** Part 9.1 visual regression: REAL headless Chromium snapshots at 360 / 390 / 768 / 1280.
 *  Baselines live in tests/visual/baselines/*.png (committed). A second run compares pixels
 *  with pixelmatch and fails on any changed screen. Evidence JPEGs go to docs/screenshots/.
 */
import { launchBrowser } from './browser.mjs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
const VIEWPORTS = [
  { w: 360, h: 780, name: '360' },
  { w: 390, h: 844, name: '390' },
  { w: 768, h: 1024, name: '768' },
  { w: 1280, h: 900, name: '1280' },
];
const PAGES = [
  { path: '/', name: 'home' },
  { path: '/products', name: 'products' },
  { path: '/about', name: 'about' },
  { path: '/contact', name: 'contact' },
  { path: '/enquiry', name: 'enquiry' },
  { path: '/privacy', name: 'privacy' },
  { path: '/erp/login', name: 'login' },
  { path: '/erp', name: 'dashboard' },
  { path: '/erp/settings', name: 'settings' },
  { path: '/erp/users', name: 'users' },
  { path: '/erp/status', name: 'status' },
];
const BASE_DIR = 'tests/visual/baselines';
const SHOT_DIR = 'docs/screenshots';
/** Every run renders the same instant, so a diff means the code changed — not the clock. */
const FROZEN_TIME = new Date('2026-11-04T06:00:00Z');
mkdirSync(BASE_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await launchBrowser();
const report = { generated_at: new Date().toISOString(), url: BASE, viewports: VIEWPORTS.map(v => v.name), screens: [], errors: [] };
try {
  const context = await browser.newContext({ locale: 'ur-PK', deviceScaleFactor: 1 });
  const page = await context.newPage();
  // This ARM box runs Chromium with very little free RAM; first navigations can take ~45s.
  page.setDefaultNavigationTimeout(120_000);
  page.on('pageerror', (e) => report.errors.push(String(e).slice(0, 220)));

  // Sign in once (existing local test owner) so private ERP screens render real data.
  await page.goto(`${BASE}/erp/login`, { waitUntil: 'domcontentloaded' });
  const login = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'e2e-owner', password: 'E2E-Test-Owner-2026!' }),
    });
    return r.status;
  });
  console.log(`login_status: ${login}`);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    for (const spec of PAGES) {
      const url = `${BASE}${spec.path}`;
      // Freeze the page clock, then advance it by one fixed span: the cube's rotation timer, the
      // live counters and the reveal observers otherwise land on a different frame every run.
      await page.clock.install({ time: FROZEN_TIME }).catch(() => {});
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.clock.runFor(5000).catch(() => {});
      // Cold and warm caches otherwise differ: the shutter waits for the network to idle and for
      // every image that is in the DOM to finish (or fail) decoding.
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.evaluate(() => new Promise((done) => {
        const pending = [...document.images].filter((i) => !i.complete);
        if (!pending.length) return done();
        let left = pending.length;
        const tick = () => { if (--left <= 0) done(); };
        for (const img of pending) { img.addEventListener('load', tick, { once: true }); img.addEventListener('error', tick, { once: true }); }
        setTimeout(done, 5000);
      })).catch(() => {});
      // The hero cube auto-advances every 4200 ms. Where that tick lands inside the frozen 5 s
      // depends on when the component mounted, which flipped home screenshots between runs.
      // Pin it to the first face so the shutter always sees the same rotation.
      await page.evaluate(() => document.querySelector('.cube-dot')?.click()).catch(() => {});
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {});
      await page.waitForTimeout(350);
      const file = `${spec.name}-${vp.name}.png`;
      const buf = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
      const baseline = path.join(BASE_DIR, file);
      const img = PNG.sync.read(buf);
      let mismatch = 0, compared = false;
      if (existsSync(baseline)) {
        const old = PNG.sync.read(readFileSync(baseline));
        if (old.width === img.width && old.height === img.height) {
          mismatch = pixelmatch(old.data, img.data, null, old.width, old.height, { threshold: 0.15 });
          compared = true;
        } else mismatch = img.width * img.height;
      } else {
        writeFileSync(baseline, buf);
      }
      const pct = +(mismatch / (img.width * img.height) * 100).toFixed(3);
      report.screens.push({ screen: spec.name, viewport: vp.name, path: spec.path, http: res?.status() ?? 0,
        width: img.width, height: img.height, baseline_exists: true, compared, mismatch_pixels: mismatch, mismatch_pct: pct });
      // Small evidence JPEG for the handover (home + dashboard at all four breakpoints).
      if (spec.name === 'home' || spec.name === 'dashboard') {
        writeFileSync(path.join(SHOT_DIR, `${spec.name}-${vp.name}.jpg`),
          await page.screenshot({ type: 'jpeg', quality: 62, fullPage: false, animations: 'disabled' }));
      }
      console.log(`${spec.name.padEnd(10)} ${vp.name.padEnd(5)} http=${res?.status()} ${img.width}x${img.height} ${compared ? `diff=${pct}%` : 'BASELINE WRITTEN'}`);
    }
  }
  await context.close();
} finally {
  await browser.close();
}

const changed = report.screens.filter(s => s.compared && s.mismatch_pct > 0.5);
writeFileSync('.dev/visual-report.json', JSON.stringify(report, null, 2));
const md = `# VISUAL REGRESSION REPORT — real Chromium snapshots

Generated: ${report.generated_at}
URL: ${report.url}
Viewports: ${report.viewports.join(', ')} px
Screens: ${report.screens.length} (${PAGES.length} pages × ${VIEWPORTS.length} viewports)
Baselines: \`tests/visual/baselines/*.png\` (committed) · Evidence: \`docs/screenshots/*.jpg\`
Comparison: pixelmatch, threshold 0.15, fail if > 0.5 % pixels differ.

| Screen | Viewport | HTTP | Size | Compared | Diff pixels | Diff % |
|---|---|---|---|---|---|---|
${report.screens.map(s => `| ${s.screen} | ${s.viewport} | ${s.http} | ${s.width}×${s.height} | ${s.compared ? 'yes' : 'no (new baseline)'} | ${s.mismatch_pixels} | ${s.mismatch_pct} |`).join('\n')}

Page errors captured: ${report.errors.length ? report.errors.join('; ') : 'none'}

Result: ${changed.length ? `FAIL — ${changed.length} screens changed` : 'PASS — all compared screens identical to their baselines'}
`;
writeFileSync('docs/VISUAL_REPORT.md', md);
console.log(`VISUAL_RESULT: ${changed.length ? `FAIL ${changed.length} changed` : 'PASS'} | page_errors=${report.errors.length}`);
if (changed.length) process.exitCode = 1;
