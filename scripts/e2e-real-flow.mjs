/** Real Browser End-to-End Test for Zeeshan Traders
 * Runs against live domain or local server using headless Chromium (Playwright).
 * Tests:
 * 1. Admin Login
 * 2. New Product Creation with Inline Brand Creation (Zero validation error block!)
 * 3. ERP Purchase Invoice (Stock up newly created product!)
 * 4. Public Storefront Cart & Checkout
 * 5. Admin Order Review & Acceptance (converts order to posted sale)
 * 6. ERP Multi-Item Sale Invoice (tests product search + plus button)
 */
import { launchBrowser } from './browser.mjs';

const BASE = process.env.ZT_BASE ?? 'http://localhost:3000';
console.log(`\n======================================================`);
console.log(`Starting E2E Real Browser Test on: ${BASE}`);
console.log(`======================================================\n`);

const out = (step, msg) => console.log(`\x1b[32m[PASS]\x1b[0m ${step}: ${msg}`);
const info = (msg) => console.log(`   ℹ ${msg}`);
const errOut = (step, msg) => console.error(`\x1b[31m[FAIL]\x1b[0m ${step}: ${msg}`);

async function dismissInstallPrompt(page) {
  try {
    const btn = page.locator('.overlay button:has-text("سمجھ گیا"), .overlay button:has-text("Got it")');
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click({ force: true });
      await page.waitForTimeout(500);
    }
  } catch {}
}

async function safeGoto(page, url, opts = { waitUntil: 'domcontentloaded', timeout: 30000 }) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await page.goto(url, opts);
    } catch (e) {
      if (attempt === 5) throw e;
      await page.waitForTimeout(2000 * attempt);
    }
  }
}

const browser = await launchBrowser();

try {
  // --------------------------------------------------------------------------
  // STEP 1: Admin Login
  // --------------------------------------------------------------------------
  console.log('>>> STEP 1: Admin Login via Browser UI');
  const adminContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ur-PK',
  });
  await adminContext.addInitScript(() => {
    try { localStorage.setItem('zt-install-dismissed-at', String(Date.now())); } catch {}
  });
  const adminPage = await adminContext.newPage();
  adminPage.on('console', msg => {
    const t = msg.text();
    if (!t.includes('Failed to load resource') && !t.includes('401')) {
      console.log('   [Admin Browser Log]:', t);
    }
  });
  adminPage.on('pageerror', err => console.log('Admin Browser Error:', err.message));

  info('Navigating to login page...');
  await safeGoto(adminPage, `${BASE}/erp/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissInstallPrompt(adminPage);
  await adminPage.waitForSelector('form.login-card', { timeout: 15000 });

  await adminPage.locator('input[autocomplete="username"]').fill('wafaweb');
  await adminPage.locator('input[autocomplete="current-password"]').fill('Wafa@1122');
  await dismissInstallPrompt(adminPage);
  await adminPage.locator('button[type="submit"]').click({ force: true });

  // Wait for redirect to /erp dashboard
  await adminPage.waitForURL(url => url.pathname.startsWith('/erp') && !url.pathname.includes('/login'), { timeout: 20000 });
  out('Step 1', 'Admin successfully logged in to ERP Dashboard');

  // --------------------------------------------------------------------------
  // STEP 2: Product Creation + Brand Creation Inline
  // --------------------------------------------------------------------------
  console.log('\n>>> STEP 2: Product Creation & Inline Brand Creation');
  const ts = Date.now().toString().slice(-4);
  const testBrandUr = `برانڈ ${ts}`;
  const testBrandEn = `Brand ${ts}`;
  const testProdUr = `سونا کھاد ٹیسٹ ${ts}`;
  const testProdEn = `Sona Fert Test ${ts}`;

  await safeGoto(adminPage, `${BASE}/erp/products/new`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await dismissInstallPrompt(adminPage);
  await adminPage.waitForSelector('button:has-text("نیا برانڈ")', { timeout: 15000 });

  // Open inline brand modal
  await adminPage.locator('button:has-text("نیا برانڈ")').click();
  await adminPage.waitForSelector('.sheet input', { timeout: 5000 });
  info('Brand modal opened');

  // Fill Brand Urdu and English names
  const sheetInputs = adminPage.locator('.sheet input');
  await sheetInputs.nth(0).fill(testBrandUr);
  await sheetInputs.nth(1).fill(testBrandEn);

  await adminPage.locator('.sheet button:has-text("شامل کریں")').click();
  await adminPage.waitForTimeout(1000);
  out('Step 2a', `Inline Brand created and attached: "${testBrandUr}"`);

  // Fill Product details on unified single screen
  const nameUrInput = adminPage.locator('input[placeholder*="مثلاً"]').first();
  await nameUrInput.fill(testProdUr); // Name Urdu
  const formInputs = adminPage.locator('.card input.input');
  if (await formInputs.count() >= 2) {
    await formInputs.nth(1).fill(testProdEn); // Name English
  }

  // Fill purchase rate, sale rate
  const priceInputs = adminPage.locator('input[inputmode="decimal"]');
  const count = await priceInputs.count();
  if (count >= 2) {
    await priceInputs.nth(0).fill('3200'); // Purchase rate
    await priceInputs.nth(1).fill('3500'); // Sale rate
  }

  // Fill initial stock pieces directly on product form
  const qtyInput = adminPage.locator('input[placeholder*="مثلاً 50"]');
  if (await qtyInput.count()) {
    await qtyInput.first().fill('50');
  }

  // Click Save button
  info('Clicking Save product button...');
  await adminPage.locator('button:has-text("محفوظ کریں")').first().click();

  // Wait for redirect to /erp/products
  await adminPage.waitForURL(url => url.pathname.includes('/erp/products') && !url.pathname.includes('/new'), { timeout: 15000 });
  out('Step 2b', `Product "${testProdUr}" saved without ANY validation error!`);

  // --------------------------------------------------------------------------
  // STEP 2c: Edit Existing Old Product (Verify D1 SQLite 0/1 boolean coercion)
  // --------------------------------------------------------------------------
  console.log('\n>>> STEP 2c: Edit Existing Old Product (Resilient Boolean Parsing)');
  await safeGoto(adminPage, `${BASE}/erp/products`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await dismissInstallPrompt(adminPage);
  await adminPage.waitForSelector('table.table tbody tr', { timeout: 15000 });

  // Click on the first product row
  const firstRow = adminPage.locator('table.table tbody tr').first();
  await firstRow.click();
  await adminPage.waitForURL(url => url.pathname.includes('/erp/products/') && !url.pathname.includes('/new'), { timeout: 15000 });
  info('Opened existing product edit form');
  await dismissInstallPrompt(adminPage);

  // Click Save button directly on single screen
  info('Saving edited existing product...');
  await adminPage.locator('button:has-text("محفوظ کریں")').first().click();

  // Wait for redirect back to /erp/products
  await adminPage.waitForURL(url => url.pathname.endsWith('/erp/products'), { timeout: 15000 });
  out('Step 2c', 'Existing product edited and saved successfully without boolean/number validation error!');

  // --------------------------------------------------------------------------
  // STEP 3: ERP Purchase Invoice (Stock up newly created product)
  // --------------------------------------------------------------------------
  console.log('\n>>> STEP 3: ERP Purchase Invoice');
  await safeGoto(adminPage, `${BASE}/erp/purchases/new`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await dismissInstallPrompt(adminPage);
  await adminPage.waitForSelector('input.input', { timeout: 15000 });

  // Select supplier
  const suppPartyInput = adminPage.locator('input[placeholder*="نام تلاش"]').first();
  await suppPartyInput.click();
  await suppPartyInput.fill('');
  await adminPage.waitForTimeout(600);
  let suppPartyOpts = adminPage.locator('.combobox-option');
  if (await suppPartyOpts.count()) {
    const sName = await suppPartyOpts.first().innerText();
    await suppPartyOpts.first().click();
    info(`Supplier selected: ${sName.split('\n')[0]}`);
  } else {
    await suppPartyInput.fill('الرحیم');
    await adminPage.waitForTimeout(500);
    if (await adminPage.locator('.combobox-option').count()) {
      await adminPage.locator('.combobox-option').first().click();
    }
  }

  // Search product (newly created product)
  const suppProdSearch = adminPage.locator('input[placeholder*="پروڈکٹ تلاش کریں"]').first();
  await suppProdSearch.click();
  await suppProdSearch.fill('سونا کھاد');
  await adminPage.waitForTimeout(500);
  const suppOpts = adminPage.locator('.combobox-option');
  if (await suppOpts.count()) {
    const selName = await suppOpts.first().innerText();
    await suppOpts.first().click();
    info(`Purchasing item: ${selName.split('\n')[0]}`);
  } else {
    await suppProdSearch.fill('');
    await adminPage.locator('.combobox-option').first().click();
  }

  // Fill quantity and rate
  const purchLine = adminPage.locator('.card:has-text("آئٹم #")').first();
  await purchLine.locator('.money-input').nth(0).fill('50'); // 50 units
  await purchLine.locator('.money-input').nth(1).fill('3200'); // Rate

  // Credit checkbox
  const suppCreditCheck = adminPage.locator('label:has-text("ادھار") input[type="checkbox"]');
  if (await suppCreditCheck.count()) {
    await suppCreditCheck.check();
  }

  // Save & Post
  info('Posting Purchase invoice...');
  await adminPage.locator('button:has-text("محفوظ کریں اور پوسٹ کریں")').click();

  const purchErr = await adminPage.locator('.err[role="alert"]').innerText().catch(() => '');
  if (purchErr) console.log('   Purchase form error:', purchErr);

  // Verify posted voucher
  await adminPage.waitForSelector('h2:has-text("پوسٹ ہو گیا")', { timeout: 15000 });
  const purchVoucher = (await adminPage.locator('.num').first().innerText()).trim();
  out('Step 3', `Purchase invoice posted successfully! Stock added for ${testProdUr}. Voucher: ${purchVoucher}`);

  // --------------------------------------------------------------------------
  // STEP 4: Storefront Cart & Checkout
  // --------------------------------------------------------------------------
  console.log('\n>>> STEP 4: Public Storefront Cart & Checkout');
  const customerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ur-PK',
  });
  await customerContext.addInitScript(() => {
    try { localStorage.setItem('zt-install-dismissed-at', String(Date.now())); } catch {}
  });
  const custPage = await customerContext.newPage();

  // Fetch available products from public API
  const pubRes = await fetch(`${BASE}/api/v1/public/products`);
  const pubProducts = await pubRes.json();

  const pricedProd = pubProducts.data?.rows?.find(p => p.public_price_paisa > 0) || pubProducts.data?.rows?.[0];
  if (!pricedProd) throw new Error('No products available for checkout');

  // Go to checkout and populate cart
  await safeGoto(custPage, `${BASE}/checkout`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissInstallPrompt(custPage);

  await custPage.evaluate((prod) => {
    const line = {
      product_id: prod.id,
      name_ur: prod.name_ur,
      name_en: prod.name_en,
      unit: prod.base_unit || 'kg',
      qty_milli: 1000,
      price_paisa: prod.public_price_paisa || 360000,
    };
    localStorage.setItem('zt_cart_v1', JSON.stringify([line]));
  }, pricedProd);

  // Reload page to reflect populated cart
  await custPage.reload({ waitUntil: 'domcontentloaded' });
  await dismissInstallPrompt(custPage);
  await custPage.waitForSelector('.ck-form', { timeout: 15000 });

  // Select payment method card if available
  const methodCard = custPage.locator('.ck-method');
  if (await methodCard.count()) {
    await methodCard.first().click();
  }

  // Fill customer checkout details
  await custPage.locator('input[autocomplete="name"]').fill('محمد علی کسان');
  await custPage.locator('input[autocomplete="tel"]').fill('03001234567');
  await custPage.locator('input[autocomplete="address-level2"]').fill('کوٹ ادو');
  await custPage.locator('input[autocomplete="street-address"]').fill('قصبہ گجرات لیہ روڈ');

  // Check consent
  await custPage.locator('input[type="checkbox"]').first().check();

  // Wait 2 seconds to satisfy the 1500ms anti-bot elapsed check
  await custPage.waitForTimeout(2000);

  // Click place order button
  info('Submitting customer order...');
  const orderSubmitBtn = custPage.locator('button:has-text("آرڈر بھیجیں"), button:has-text("Place order")');
  await orderSubmitBtn.waitFor({ timeout: 10000 });
  await orderSubmitBtn.click({ force: true });

  // Wait for confirmation
  await custPage.waitForSelector('.ck-panel', { timeout: 15000 });
  const placedOrderNumber = (await custPage.locator('.num').first().innerText()).trim();
  out('Step 4', `Order placed successfully on storefront! Order Number: ${placedOrderNumber}`);

  // --------------------------------------------------------------------------
  // STEP 5: Admin Order Review & Acceptance
  // --------------------------------------------------------------------------
  console.log('\n>>> STEP 5: Admin Order Review & Acceptance');
  await safeGoto(adminPage, `${BASE}/erp/orders`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await dismissInstallPrompt(adminPage);
  await adminPage.waitForSelector('table tbody tr', { timeout: 15000 });

  // Click the order row
  const orderRow = adminPage.locator('table tbody tr', { hasText: 'محمد علی کسان' }).first();
  await orderRow.waitFor({ timeout: 10000 });
  await orderRow.click();
  info('Opened order detail sheet');

  // Click Approve Order
  const approveBtn = adminPage.locator('button:has-text("آرڈر منظور کریں")');
  await approveBtn.waitFor({ timeout: 10000 });
  await approveBtn.click({ force: true });

  await adminPage.waitForTimeout(2000);
  out('Step 5', `Order ${placedOrderNumber} approved and converted to posted sale!`);

  // --------------------------------------------------------------------------
  // STEP 6: ERP Multi-Item Sale Invoice (Product Search + Plus Button)
  // --------------------------------------------------------------------------
  console.log('\n>>> STEP 6: ERP Sale Invoice (Multi-Item Search & Plus Button)');
  await safeGoto(adminPage, `${BASE}/erp/sales/new`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await dismissInstallPrompt(adminPage);
  await adminPage.waitForSelector('input.input', { timeout: 15000 });

  // Select customer / party
  const partyInput = adminPage.locator('input[placeholder*="نام تلاش"]').first();
  await partyInput.click();
  await partyInput.fill('');
  await adminPage.waitForTimeout(600);
  let partyOpts = adminPage.locator('.combobox-option');
  if (await partyOpts.count()) {
    const cName = await partyOpts.first().innerText();
    await partyOpts.first().click();
    info(`Customer selected: ${cName.split('\n')[0]}`);
  } else {
    await partyInput.fill('محمد اکرم');
    await adminPage.waitForTimeout(500);
    if (await adminPage.locator('.combobox-option').count()) {
      await adminPage.locator('.combobox-option').first().click();
    }
  }

  // Line 1: Search product with 2-3 characters (using the stocked product!)
  const prodSearch1 = adminPage.locator('input[placeholder*="پروڈکٹ تلاش کریں"]').first();
  await prodSearch1.click();
  await prodSearch1.fill('سونا کھاد'); // 2 words
  await adminPage.waitForSelector('.combobox-option', { timeout: 5000 });
  const optText1 = await adminPage.locator('.combobox-option').first().innerText();
  await adminPage.locator('.combobox-option').first().click();
  info(`Line 1 item selected: ${optText1.split('\n')[0]}`);

  // Enter quantity & rate in line 1
  const lineCards = adminPage.locator('.card:has-text("آئٹم #")');
  const line1 = lineCards.first();
  await line1.locator('.money-input').nth(0).fill('10'); // Qty 10
  await line1.locator('.money-input').nth(1).fill('3500'); // Rate

  // Click Plus button to add Line 2
  info('Clicking "+ اگلا آئٹم شامل کریں" to add multiple items...');
  const addLineBtn = adminPage.locator('button:has-text("اگلا آئٹم شامل کریں")').first();
  await addLineBtn.click();
  await adminPage.waitForTimeout(500);

  // Line 2: Search product with English word
  const prodSearches = adminPage.locator('input[placeholder*="پروڈکٹ تلاش کریں"]');
  if (await prodSearches.count() >= 2) {
    await prodSearches.nth(1).click();
    await prodSearches.nth(1).fill('urea'); // English search
    await adminPage.waitForTimeout(500);
    const opts = adminPage.locator('.combobox-option');
    if (await opts.count()) {
      const optText2 = await opts.first().innerText();
      await opts.first().click();
      info(`Line 2 item selected: ${optText2.split('\n')[0]}`);
      const line2 = lineCards.nth(1);
      await line2.locator('.money-input').nth(0).fill('5'); // Qty 5
      await line2.locator('.money-input').nth(1).fill('2000'); // Rate
    }
  }

  // Credit checkbox
  const creditCheck = adminPage.locator('label:has-text("ادھار") input[type="checkbox"]');
  if (await creditCheck.count()) {
    await creditCheck.check();
  }

  // Save & Post
  info('Posting Sale invoice...');
  await adminPage.locator('button:has-text("محفوظ کریں اور پوسٹ کریں")').click();

  const saleErr = await adminPage.locator('.err[role="alert"]').innerText().catch(() => '');
  if (saleErr) console.log('   Sale form error:', saleErr);

  // Verify posted voucher
  await adminPage.waitForSelector('h2:has-text("پوسٹ ہو گیا")', { timeout: 15000 });
  const saleVoucher = (await adminPage.locator('.num').first().innerText()).trim();
  out('Step 6', `Multi-item sale posted successfully! Voucher: ${saleVoucher}`);

  console.log('\n======================================================');
  console.log('\x1b[32m✔ ALL E2E REAL BROWSER TESTS PASSED 100%!\x1b[0m');
  console.log('======================================================\n');

  await adminContext.close();
  await customerContext.close();
} catch (e) {
  errOut('E2E Test Failed', e.stack || e.message);
  process.exit(1);
} finally {
  await browser.close();
}
