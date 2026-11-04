/** P9-VISUAL — NOT EXECUTED in this build (@playwright/test and browsers are not installed).
 *  These specs are the intended gate; run them after `npm i -D @playwright/test && npx playwright install`.
 *  Capture baselines once, then `npx playwright test` on every UI change. */
import { test, expect } from '@playwright/test';

const screens = [
  { name: 'public-home', path: '/', public: true },
  { name: 'public-products', path: '/products', public: true },
  { name: 'public-enquiry', path: '/enquiry', public: true },
  { name: 'erp-login', path: '/erp/login', public: true },
  { name: 'erp-dashboard', path: '/erp' },
  { name: 'erp-products', path: '/erp/products' },
  { name: 'erp-sale-form', path: '/erp/fertilizer/sale/new' },
  { name: 'erp-khata', path: '/erp/khata' },
  { name: 'erp-reports', path: '/erp/reports' },
  { name: 'erp-status', path: '/erp/status' },
];

for (const s of screens) {
  test(`snapshot ${s.name}`, async ({ page }) => {
    await page.goto(s.path, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toHaveScreenshot(`${s.name}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
  });
}
