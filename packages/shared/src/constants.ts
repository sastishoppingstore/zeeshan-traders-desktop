/**
 * Zeeshan Traders — canonical business constants.
 * Only the business profile below is pre-filled (spec H8). No prices, stock,
 * balances, licence numbers or opening hours are invented anywhere in this file.
 */

export const BUSINESS_PROFILE = {
  name_ur: 'ذیشان ٹریڈرز',
  name_en: 'Zeeshan Traders',
  location_ur: 'مقصود چوک، ضلع لیہ، پنجاب، پاکستان',
  location_en: 'Maqsood Chowk, District Layyah, Punjab, Pakistan',
  phone1: '0307-7864722',
  phone2: '0345-4654722',
  whatsapp1: 'https://wa.me/923077864722',
  whatsapp2: 'https://wa.me/923454654722',
  currency: 'PKR',
  timezone: 'Asia/Karachi',
  locale: 'en-PK',
  fiscal_start_month: 7, // 1 July – 30 June
  fiscal_start_day: 1,
  week_starts: 'SAT',
  default_lang: 'ur',
  default_dir: 'rtl',
} as const;

/** Business lines / khata books. Every ledger line carries a book_code. */
export type BookCode =
  | 'FERT' | 'PEST' | 'CHOK' | 'WAND' | 'CEM' | 'SEED' | 'OTHR'
  | 'WHEAT' | 'RICE' | 'SESAME' | 'MILLET' | 'MAIZE' | 'MOONG' | 'MUSTARD'
  | 'SHOP' | 'PAYROLL' | 'GENERAL';

export interface BookDef {
  code: BookCode;
  ur: string;
  en: string;
  kind: 'goods' | 'grain' | 'expense' | 'payroll' | 'general';
  /** chart-of-accounts codes */
  sales: string;
  cogs: string;
  inventory: string;
  category_code?: string;
}

export const BOOKS: BookDef[] = [
  { code: 'FERT',   ur: 'کھاد',       en: 'Fertilizer',  kind: 'goods',  sales: '4010', cogs: '5010', inventory: '1201', category_code: 'FERT' },
  { code: 'PEST',   ur: 'پیسٹی سائیڈ', en: 'Pesticide',   kind: 'goods',  sales: '4020', cogs: '5020', inventory: '1202', category_code: 'PEST' },
  { code: 'CHOK',   ur: 'چوکر',       en: 'Choker',      kind: 'goods',  sales: '4030', cogs: '5030', inventory: '1203', category_code: 'CHOK' },
  { code: 'WAND',   ur: 'ونڈا',       en: 'Wanda',       kind: 'goods',  sales: '4040', cogs: '5040', inventory: '1204', category_code: 'WAND' },
  { code: 'CEM',    ur: 'سیمنٹ',      en: 'Cement',      kind: 'goods',  sales: '4050', cogs: '5050', inventory: '1205', category_code: 'CEM' },
  { code: 'SEED',   ur: 'بیج',        en: 'Seeds',       kind: 'goods',  sales: '4060', cogs: '5060', inventory: '1206', category_code: 'SEED' },
  { code: 'OTHR',   ur: 'دیگر زرعی سامان', en: 'Other agri goods', kind: 'goods', sales: '4070', cogs: '5070', inventory: '1207', category_code: 'OTHR' },
  { code: 'WHEAT',  ur: 'گندم',       en: 'Wheat',       kind: 'grain',  sales: '4201', cogs: '5201', inventory: '1211', category_code: 'WHEAT' },
  { code: 'RICE',   ur: 'چاول',       en: 'Rice',        kind: 'grain',  sales: '4202', cogs: '5202', inventory: '1212', category_code: 'RICE' },
  { code: 'SESAME', ur: 'تل',         en: 'Sesame',      kind: 'grain',  sales: '4203', cogs: '5203', inventory: '1213', category_code: 'SESAME' },
  { code: 'MILLET', ur: 'باجرہ',      en: 'Millet',      kind: 'grain',  sales: '4204', cogs: '5204', inventory: '1214', category_code: 'MILLET' },
  { code: 'MAIZE',  ur: 'مکئی',       en: 'Maize',       kind: 'grain',  sales: '4205', cogs: '5205', inventory: '1215', category_code: 'MAIZE' },
  { code: 'MOONG',  ur: 'مونگی',      en: 'Moong',       kind: 'grain',  sales: '4206', cogs: '5206', inventory: '1216', category_code: 'MOONG' },
  { code: 'MUSTARD',ur: 'سرسوں',      en: 'Mustard',     kind: 'grain',  sales: '4207', cogs: '5207', inventory: '1217', category_code: 'MUSTARD' },
  { code: 'SHOP',   ur: 'دکان کے اخراجات', en: 'Shop expenses', kind: 'expense', sales: '4900', cogs: '5900', inventory: '1290' },
  { code: 'PAYROLL',ur: 'ملازم تنخواہ', en: 'Payroll',    kind: 'payroll', sales: '4900', cogs: '5900', inventory: '1290' },
  { code: 'GENERAL',ur: 'اخراجات',    en: 'General expenses', kind: 'general', sales: '4900', cogs: '5900', inventory: '1290' },
];

export const BOOK_MAP: Record<string, BookDef> = Object.fromEntries(BOOKS.map((b) => [b.code, b]));
export const CROP_CODES = ['WHEAT', 'RICE', 'SESAME', 'MILLET', 'MAIZE', 'MOONG', 'MUSTARD'] as const;
export type CropCode = (typeof CROP_CODES)[number];
export const GOODS_CODES = ['FERT', 'PEST', 'CHOK', 'WAND', 'CEM', 'SEED', 'OTHR'] as const;
export const ALL_KHATA_BOOKS = [...BOOKS.map((b) => b.code)];

/** Money books — four separate accounts, four separate statements. */
export const MONEY_ACCOUNTS = [
  { code: 'CASH',    ur: 'نقد رقم',        en: 'Cash in hand', gl: '1000', type: 'cash' },
  { code: 'JAZZ',    ur: 'جاز کیش',        en: 'JazzCash',    gl: '1010', type: 'wallet' },
  { code: 'MEEZAN',  ur: 'میزان بینک',     en: 'Meezan Bank', gl: '1020', type: 'bank' },
  { code: 'UBL',     ur: 'یو بی ایل بینک', en: 'UBL Bank',    gl: '1030', type: 'bank' },
] as const;
export type MoneyAccountCode = (typeof MONEY_ACCOUNTS)[number]['code'];
export const MONEY_MAP: Record<string, (typeof MONEY_ACCOUNTS)[number]> = Object.fromEntries(
  MONEY_ACCOUNTS.map((a) => [a.code, a]),
);

/** Chart of accounts (codes editable in Settings; these are the system defaults). */
export const CHART_OF_ACCOUNTS = [
  { code: '1000', ur: 'نقد رقم', en: 'Cash', type: 'asset' },
  { code: '1010', ur: 'جاز کیش', en: 'JazzCash', type: 'asset' },
  { code: '1020', ur: 'میزان بینک', en: 'Meezan Bank', type: 'asset' },
  { code: '1030', ur: 'یو بی ایل بینک', en: 'UBL Bank', type: 'asset' },
  { code: '1100', ur: 'وصولی اکاؤنٹس (ادھار وصولی)', en: 'Accounts Receivable', type: 'asset' },
  { code: '1150', ur: 'ملازم ایڈوانس', en: 'Employee Advances', type: 'asset' },
  { code: '1200', ur: 'اسٹاک (انوینٹری)', en: 'Inventory (control)', type: 'asset', parent: true },
  ...BOOKS.filter((b) => b.kind === 'goods' || b.kind === 'grain').map((b) => ({
    code: b.inventory, ur: `اسٹاک — ${b.ur}`, en: `Inventory — ${b.en}`, type: 'asset',
  })),
  { code: '2000', ur: 'قابلِ ادائیگی اکاؤنٹس', en: 'Accounts Payable', type: 'liability' },
  { code: '2100', ur: 'قابلِ ادائیگی تنخواہیں', en: 'Salaries Payable', type: 'liability' },
  { code: '3000', ur: 'سرمایہ', en: 'Capital', type: 'equity' },
  { code: '3100', ur: 'ذاتی نکاسی', en: 'Drawings', type: 'equity' },
  { code: '3900', ur: 'ابتدائی ایکوئٹی', en: 'Opening Equity', type: 'equity' },
  ...BOOKS.filter((b) => b.kind === 'goods' || b.kind === 'grain').map((b) => ({
    code: b.sales, ur: `فروخت — ${b.ur}`, en: `Sales — ${b.en}`, type: 'income',
  })),
  { code: '4900', ur: 'فروخت واپسی / رعایت', en: 'Sales Returns / Discounts', type: 'income' },
  ...BOOKS.filter((b) => b.kind === 'goods' || b.kind === 'grain').map((b) => ({
    code: b.cogs, ur: `لاگتِ فروخت — ${b.ur}`, en: `COGS — ${b.en}`, type: 'expense',
  })),
  { code: '6010', ur: 'مال برداری / فریٹ', en: 'Freight', type: 'expense' },
  { code: '6020', ur: 'لوڈنگ / ان لوڈنگ', en: 'Loading / unloading', type: 'expense' },
  { code: '6030', ur: 'مزدوری', en: 'Labour', type: 'expense' },
  { code: '6040', ur: 'کرایہ', en: 'Rent', type: 'expense' },
  { code: '6050', ur: 'بجلی / یوٹیلیٹیز', en: 'Utilities', type: 'expense' },
  { code: '6060', ur: 'مرمت', en: 'Repairs', type: 'expense' },
  { code: '6070', ur: 'بینک / جاز کیش چارجز', en: 'Bank / JazzCash charges', type: 'expense' },
  { code: '6080', ur: 'تنخواہیں', en: 'Salaries', type: 'expense' },
  { code: '6090', ur: 'کمیشن', en: 'Commission', type: 'expense' },
  { code: '6100', ur: 'ٹرانسپورٹ', en: 'Transport', type: 'expense' },
  { code: '6190', ur: 'دیگر اخراجات', en: 'Other expenses', type: 'expense' },
  { code: '7000', ur: 'اسٹاک اضافہ / نقصان', en: 'Stock gain / loss', type: 'expense' },
];

export const EXPENSE_CATEGORIES = [
  { code: 'RENT', ur: 'کرایہ', en: 'Rent', group: 'SHOP', gl: '6040' },
  { code: 'ELECTRIC', ur: 'بجلی', en: 'Electricity', group: 'SHOP', gl: '6050' },
  { code: 'WATER', ur: 'پانی', en: 'Water', group: 'SHOP', gl: '6050' },
  { code: 'INTERNET', ur: 'انٹرنیٹ', en: 'Internet', group: 'SHOP', gl: '6050' },
  { code: 'TRANSPORT', ur: 'ٹرانسپورٹ', en: 'Transport', group: 'GENERAL', gl: '6100' },
  { code: 'FREIGHT', ur: 'مال برداری', en: 'Freight', group: 'GENERAL', gl: '6010' },
  { code: 'LOADING', ur: 'لوڈنگ / ان لوڈنگ', en: 'Loading / unloading', group: 'GENERAL', gl: '6020' },
  { code: 'LABOUR', ur: 'مزدوری', en: 'Labour', group: 'GENERAL', gl: '6030' },
  { code: 'REPAIRS', ur: 'مرمت', en: 'Repairs', group: 'SHOP', gl: '6060' },
  { code: 'STATIONERY', ur: 'اسٹیشنری', en: 'Stationery', group: 'SHOP', gl: '6190' },
  { code: 'BANK_CHARGES', ur: 'بینک چارجز', en: 'Bank charges', group: 'GENERAL', gl: '6070' },
  { code: 'FEES', ur: 'فیسیں', en: 'Fees', group: 'GENERAL', gl: '6190' },
  { code: 'OTHER', ur: 'دیگر', en: 'Other', group: 'GENERAL', gl: '6190' },
];

export const PARTY_TYPES = [
  { code: 'CUSTOMER', ur: 'گاہک', en: 'Customer' },
  { code: 'SUPPLIER', ur: 'سپلائر', en: 'Supplier' },
  { code: 'FARMER', ur: 'کاشتکار', en: 'Farmer' },
  { code: 'EMPLOYEE', ur: 'ملازم', en: 'Employee' },
] as const;

/** Deny-by-default permission matrix. Owner holds '*'. */
export const PERMISSIONS = [
  'setup.execute', 'auth.login', 'dashboard.view',
  'products.read', 'products.write', 'products.publish', 'products.import',
  'catalogue.read', 'catalogue.write',
  'parties.read', 'parties.write',
  'purchases.read', 'purchases.post', 'sales.read', 'sales.post',
  'returns.read', 'returns.post',
  'grains.read', 'grains.post',
  'stock.read', 'stock.adjust', 'stock.count',
  'khata.read', 'reports.view', 'reports.export',
  'accounts.read', 'accounts.write', 'receipts.post', 'payments.post', 'transfers.post', 'reconcile.write',
  'expenses.read', 'expenses.post',
  'employees.read', 'employees.write', 'payroll.post',
  'documents.read', 'documents.print',
  'accounting.read', 'accounting.post', 'period.close',
  'cms.read', 'cms.write', 'enquiries.read', 'enquiries.write',
  'orders.read', 'orders.review', 'payments.methods.write',
  'sync.read', 'sync.resolve', 'backup.read', 'backup.run', 'backup.restore',
  'users.read', 'users.write', 'settings.read', 'settings.write', 'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  { code: 'OWNER', ur: 'مالک', en: 'Owner', perms: ['*'] },
  { code: 'MANAGER', ur: 'منیجر', en: 'Manager', perms: PERMISSIONS.filter((p) => !['setup.execute', 'users.write', 'settings.write', 'period.close', 'backup.restore', 'sync.resolve', 'payments.methods.write'].includes(p)) },
  { code: 'ACCOUNTANT', ur: 'اکاؤنٹنٹ', en: 'Accountant', perms: ['auth.login', 'dashboard.view', 'products.read', 'catalogue.read', 'parties.read', 'purchases.read', 'sales.read', 'returns.read', 'grains.read', 'stock.read', 'khata.read', 'reports.view', 'reports.export', 'accounts.read', 'accounts.write', 'receipts.post', 'payments.post', 'transfers.post', 'reconcile.write', 'expenses.read', 'expenses.post', 'employees.read', 'payroll.post', 'documents.read', 'documents.print', 'accounting.read', 'accounting.post', 'sync.read', 'audit.read', 'settings.read'] },
  { code: 'SALESPERSON', ur: 'سیلز پرسن', en: 'Salesperson', perms: ['auth.login', 'dashboard.view', 'products.read', 'parties.read', 'parties.write', 'sales.read', 'sales.post', 'returns.read', 'stock.read', 'khata.read', 'receipts.post', 'documents.read', 'documents.print', 'sync.read'] },
  { code: 'STOREKEEPER', ur: 'اسٹور کیپر', en: 'Storekeeper', perms: ['auth.login', 'dashboard.view', 'products.read', 'products.write', 'catalogue.read', 'purchases.read', 'purchases.post', 'stock.read', 'stock.count', 'grains.read', 'grains.post', 'sync.read'] },
  { code: 'WORKER', ur: 'ورکر (بل پر کٹمر)', en: 'Shop worker — invoices only', perms: ['auth.login', 'dashboard.view', 'products.read', 'parties.read', 'parties.write', 'sales.read', 'sales.post', 'receipts.post', 'stock.read', 'khata.read', 'documents.read', 'documents.print', 'orders.read', 'sync.read'] },
  { code: 'AUDITOR', ur: 'صرف پڑھنے والا آڈیٹر', en: 'Read-only Auditor', perms: ['auth.login', 'dashboard.view', 'products.read', 'catalogue.read', 'parties.read', 'purchases.read', 'sales.read', 'returns.read', 'grains.read', 'stock.read', 'khata.read', 'reports.view', 'accounts.read', 'expenses.read', 'employees.read', 'documents.read', 'accounting.read', 'audit.read', 'settings.read'] },
] as const;

export const DOC_PREFIXES: Record<string, string> = {
  FERT_SALE: 'FS', FERT_PURCHASE: 'FP', PEST_SALE: 'PS', PEST_PURCHASE: 'PP',
  CHOK_SALE: 'CS', CHOK_PURCHASE: 'CP', WAND_SALE: 'WS', WAND_PURCHASE: 'WP',
  CEM_SALE: 'ES', CEM_PURCHASE: 'EP', SEED_SALE: 'SS', SEED_PURCHASE: 'SP',
  OTHR_SALE: 'OS', OTHR_PURCHASE: 'OP',
  WHEAT_SALE: 'GWS', WHEAT_PURCHASE: 'GWP', RICE_SALE: 'GRS', RICE_PURCHASE: 'GRP',
  SESAME_SALE: 'GSS', SESAME_PURCHASE: 'GSP', MILLET_SALE: 'GMS', MILLET_PURCHASE: 'GMP',
  MAIZE_SALE: 'GZS', MAIZE_PURCHASE: 'GZP', MOONG_SALE: 'GOS', MOONG_PURCHASE: 'GOP',
  MUSTARD_SALE: 'GTS', MUSTARD_PURCHASE: 'GTP',
  RECEIPT: 'RC', PAYMENT: 'PV', EXPENSE: 'EX', SALARY: 'SL', TRANSFER: 'TR',
  ADJUSTMENT: 'AD', SALE_RETURN: 'SR', PURCHASE_RETURN: 'PR', ENQUIRY: 'EQ', QUOTATION: 'QT',
  ORDER: 'OD', PAYMENT_METHOD: 'PM',
};

/** Settings keys. Values are owner-entered; nothing here invents business data. */
export const SETTINGS_KEYS = [
  'business', 'maund_kg', 'maund_confirmed', 'bag_sizes_confirmed',
  'fiscal_year', 'numbering_prefixes', 'print_size', 'invoice_footer',
  'require_cnic_on_fertilizer_sale', 'cnic_enabled', 'negative_stock_allowed',
  'landed_cost_basis', 'grain_rate_basis', 'near_expiry_days', 'record_retention_years',
  'pesticide_licence_no', 'pesticide_licence_expiry', 'fertilizer_authorisation_no',
  'fertilizer_authorisation_expiry', 'opening_hours', 'logo_r2_key', 'social_links',
  'theme', 'language', 'setup_complete', 'period_lock', 'privacy_cnic',
  'low_stock_alerts', 'backup_retention',
] as const;

export const STATUS = {
  DRAFT: 'DRAFT', POSTED: 'POSTED', REVERSED: 'REVERSED',
  PENDING_SYNC: 'PENDING_SYNC', SYNCED: 'SYNCED', CONFLICT: 'CONFLICT',
} as const;
