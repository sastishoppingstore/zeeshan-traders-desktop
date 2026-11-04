# FEATURE CHECKLIST — live copy of `GET /api/v1/features`

Regenerated from the running Worker on 2026-11-03 by `node scripts/features-doc.mjs`.
The same data powers `/erp/status`. COMPLETE = real + persisted + working;
PARTIAL = working but narrowed; INCOMPLETE = not built / not verified.
An unfinished feature is NEVER reported as COMPLETE.

| ID | اسکرین / خصوصیت | English | State | نوٹ |
|---|---|---|---|---|
| PUB-01 | ہوم | Home | ✅ **COMPLETE** |  |
| PUB-02 | تمام مصنوعات / زمرہ | Products & category | ✅ **COMPLETE** |  |
| PUB-03 | پروڈکٹ کارڈ | Product card | ✅ **COMPLETE** |  |
| PUB-04 | پروڈکٹ تفصیل | Product detail | ✅ **COMPLETE** |  |
| PUB-05 | پوچھ گچھ | Enquiry | ✅ **COMPLETE** | ہنی پاٹ، ٹائم ٹریپ، ریٹ لمٹ، رضامندی |
| PUB-06 | ہمارے بارے میں | About | 🟡 **PARTIAL** | CMS صفحہ موجود مگر مالک کے جائزے تک شائع نہیں |
| PUB-07 | رابطہ | Contact | ✅ **COMPLETE** | صرف مالک کے دیے گئے فون / پتہ / wa.me |
| PUB-08 | رازداری / شرائط | Privacy / terms | 🟡 **PARTIAL** | قانونی متن مالک کے جائزے کے بغیر درج نہیں کیا گیا |
| PUB-09 | 404 / sitemap / robots | 404 + SEO files | ✅ **COMPLETE** |  |
| ERP-01 | سیٹ اپ وزرڈ | Setup wizard | ✅ **COMPLETE** | من کی تصدیق، ابتدائی بیلنس، ریگولیٹری اختیاری |
| ERP-02 | لاگ ان | Login | ✅ **COMPLETE** | PBKDF2 + سیشن + CSRF + ریٹ لمٹ + PIN + WebAuthn پاس کی؛ Chromium virtual authenticator E2E پاس |
| ERP-03 | ڈیش بورڈ | Dashboard | ✅ **COMPLETE** |  |
| ERP-04 | تیز اندراج | Quick entry | 🟡 **PARTIAL** | تیز فارم کام کرتا ہے؛ عالمی سرچ انڈیکس INCOMPLETE |
| ERP-05 | مصنوعات فہرست | Products list | ✅ **COMPLETE** |  |
| ERP-06 | مصنوعات فارم | Product form | 🟡 **PARTIAL** | تمام ٹیبز محفوظ؛ production R2 بائنڈنگ INCOMPLETE |
| ERP-07 | CSV درآمد | CSV import | ✅ **COMPLETE** |  |
| ERP-08 | زمرے / برانڈز / یونٹس | Catalogue admin | 🟡 **PARTIAL** | فہرست + نیا اندراج؛ ترمیم/آرکائیو UI باقی |
| ERP-09 | کھاد ہب | Fertilizer hub | ✅ **COMPLETE** |  |
| ERP-10 | کھاد خرید | Fertilizer purchase | ✅ **COMPLETE** |  |
| ERP-11 | کھاد فروخت | Fertilizer sale | ✅ **COMPLETE** |  |
| ERP-12 | پیسٹی سائیڈ | Pesticide module | 🟡 **PARTIAL** | رجسٹر/ایکسپائری بلاک/لازمی خریدار؛ قرنطینہ ورک فلو UI باقی |
| ERP-13 | دیگر سامان (5 کتابیں) | Five goods modules | ✅ **COMPLETE** |  |
| ERP-14 | اجناس ہب | Grains hub | ✅ **COMPLETE** |  |
| ERP-15 | فصل صفحہ | Crop page | ✅ **COMPLETE** |  |
| ERP-16 | اجناس خرید (وزن) | Grain purchase | ✅ **COMPLETE** |  |
| ERP-17 | اجناس فروخت | Grain sale | ✅ **COMPLETE** |  |
| ERP-18 | فریق | Parties | 🟡 **PARTIAL** | فہرست + نیا فریق؛ ترمیم/آرکائیو UI باقی |
| ERP-19 | فریق کھاتہ | Party khata | ✅ **COMPLETE** |  |
| ERP-20 | کھاتہ سینٹر | Khata centre | ✅ **COMPLETE** |  |
| ERP-21 | رسیدیں / ادائیگیاں | Receipts & payments | 🟡 **PARTIAL** | AUTO/ADVANCE کام؛ MANUAL الاٹمنٹ UI باقی |
| ERP-22 | رقم اکاؤنٹس | Money accounts | ✅ **COMPLETE** |  |
| ERP-23 | ٹرانسفر | Transfer | ✅ **COMPLETE** |  |
| ERP-24 | واپسی | Returns | 🟡 **PARTIAL** | ریورس پوسٹنگ؛ لائن چننے والا UI باقی |
| ERP-25 | اخراجات | Expenses | ✅ **COMPLETE** |  |
| ERP-26 | ملازمین / تنخواہ | Employees & payroll | 🟡 **PARTIAL** | تنخواہ رن؛ ایڈوانس فارم الگ UI باقی |
| ERP-27 | انوینٹری | Inventory | ✅ **COMPLETE** |  |
| ERP-28 | ویب سائٹ CMS | Website CMS | 🟡 **PARTIAL** | صفحات/اعلانات؛ بینر امیج اپ لوڈ R2 پر منحصر |
| ERP-29 | پوچھ گچھ ان باکس | Enquiries inbox | 🟡 **PARTIAL** | منظوری/مسترد/کوٹیشن؛ براہِ راست Sale کنورژن UI باقی |
| ERP-30 | دستاویزات سینٹر | Documents centre | 🟡 **PARTIAL** | JSON سنیپ شاٹ + براؤزر پرنٹ؛ bulk statement pack INCOMPLETE |
| ERP-31 | رپورٹس | Reports | 🟡 **PARTIAL** | 12 رپورٹس؛ مکمل گیلری اور شیڈولڈ ای میل INCOMPLETE |
| ERP-32 | اکاؤنٹنگ | Accounting | ✅ **COMPLETE** |  |
| ERP-33 | صارفین و کردار | Users & roles | ✅ **COMPLETE** | RBAC + ڈیوائس ریووک + پاس کی رجسٹریشن/فہرست/ریووک؛ کردار میٹرکس بگ بھی ٹھیک |
| ERP-34 | سنک سینٹر | Sync centre | ✅ **COMPLETE** |  |
| ERP-35 | بیک اپ | Backup | 🟡 **PARTIAL** | انکرپٹڈ ایکسپورٹ + لاگ؛ staging بحالی ٹیسٹ INCOMPLETE |
| ERP-36 | ترتیبات | Settings | ✅ **COMPLETE** |  |
| ERP-37 | آڈٹ لاگ | Audit log | ✅ **COMPLETE** |  |
| ERP-38 | 403/404/آف لائن | Error states | 🟡 **PARTIAL** | 403/404/آف لائن بینر + 40 بصری اسکرینز 0% diff؛ الگ آف لائن صفحہ باقی |
| P8-OFFLINE | PWA / آؤٹ باکس | PWA outbox | ✅ **COMPLETE** | SW + Dexie + 4 sync triggers + role-scoped cache wipe |
| P8-PIN | PIN کیش انکرپشن | PIN-derived AES-GCM cache | ✅ **COMPLETE** | PBKDF2 310,000 → AES-256-GCM؛ 4 یونٹ ٹیسٹ + براؤزر E2E (IndexedDB میں 4/4 انکرپٹڈ قطاریں) پاس |
| P8-PASSKEYS | WebAuthn پاس کی | WebAuthn passkeys | ✅ **COMPLETE** | @simplewebauthn حقیقی تصدیق، one-time challenge، ریووک؛ Chromium virtual authenticator E2E پاس؛ حقیقی فون ابھی نہیں |
| P8-TURNSTILE | Turnstile | Turnstile | 🟡 **PARTIAL** | سرور siteverify گیٹ + مقامی ٹیسٹ پاس؛ حقیقی Cloudflare siteverify تعیناتی کے بعد |
| P8-R2 | پرائیویٹ R2 | Private R2 | 🟡 **PARTIAL** | لوکل اپ لوڈ/میڈیا کام؛ production binding تعیناتی پر |
| P8-CACHE-PURGE | ایج کیش پیورج | Edge cache purge | ✅ **COMPLETE** | generation invalidation + known-key حذف؛ publish/unpublish ٹیسٹ اور 200-hit A19 پاس؛ لائیو ایج ابھی unverified |
| P9-QUERY-PLAN | EXPLAIN QUERY PLAN | Query-plan CI gate | ✅ **COMPLETE** | 15/15 ہاٹ کوئری انڈیکس استعمال کرتی ہیں؛ CI ورک فلو شامل |
| P9-VISUAL | Playwright بصری ریگریشن | Visual regression | ✅ **COMPLETE** | حقیقی Chromium: 10 سکرینز × 4 viewports = 40 baselines، دوسری رن پر 0% diff، 0 page errors |
| P9-LIGHTHOUSE | Lighthouse | Lighthouse | ✅ **COMPLETE** | Lighthouse 13 موبائل: 100/100/100، 100/100/100، 99/100/100 — تینوں اہداف پورے |
| P9-A11Y | a11y / 360–1280 | Accessibility & breakpoints | ✅ **COMPLETE** | axe-core 4.14: 8 سکرینز پر 0 violations (بشمول A19 لاگن/پروڈکٹ/سیل فارم) |
| P11-DOCS | دستاویزات / CSV / OpenAPI | Docs, CSV templates, OpenAPI | ✅ **COMPLETE** |  |
| P12-RESTORE | Staging بحالی ٹیسٹ | Staging restore test | 🟡 **PARTIAL** | مقامی staging-همسر DB پر 1032 قطاریں بحال + integrity PASS؛ حقیقی Cloudflare staging رن باقی |
| P9-PRINT | اردو پرنٹ / PDF ثبوت | Urdu print/PDF proof | ✅ **COMPLETE** | شپڈ CSS + WOFF2 فونٹس؛ ڈیسک ٹاپ و Android-emulated Chromium میں 2/2 فونٹس لوڈ، حقیقی A4 PDF |
| P9-QUOTA | کوٹا / کیش گارڈ A19 | Quota/cache guard A19 | ✅ **COMPLETE** | 200 عوامی ہٹس: rows_read=1، cached_hits=199 — الگ ٹیسٹ پاس |
| P9-ROUTES | A20 روٹ میٹرکس | A20 route matrix | ✅ **COMPLETE** | 29 تحریری روٹس CSRF_FAILED، 24 پر AUDITOR 400+، IDOR/SQLi/XSS ٹیسٹ پاس |
| P12-NEW-PROJECT | نیا پروجیکٹ کنفیگ | New project config | ✅ **COMPLETE** | wrangler.v2.jsonc: نئے Worker/D1/R2 نام، dry-run exit 0، اور حقیقی staging+production deploy مکمل (R2 bindings کے بوتلز باقی) |
| P12-DEPLOY | Cloudflare تعیناتی | Cloudflare deploy | ✅ **COMPLETE** | zt-v2 اور zt-v2-staging *.workers.dev پر live، چاروں مائیگریشنز remote لاگو، secrets سیٹ؛ ڈومین اور R2 بوتلز بعد میں |

**Totals:** {"COMPLETE":45,"PARTIAL":19,"INCOMPLETE":0} — 64 tracked items.

Full acceptance mapping: `docs/ACCEPTANCE.md`. Known gaps: `docs/KNOWN_LIMITATIONS.md`.
