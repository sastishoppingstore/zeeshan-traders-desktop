/** Visual-regression config (P9-VISUAL). CONFIG ONLY — browsers were not installed in this sandbox,
 *  so no snapshot has been captured and this gate is INCOMPLETE. See docs/KNOWN_LIMITATIONS.md. */
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}{ext}',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '.dev/playwright-report', open: 'never' }]],
  use: { baseURL: process.env.ZT_BASE_URL ?? 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 780 } } },
    { name: 'mobile-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'tablet-768', use: { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
});
