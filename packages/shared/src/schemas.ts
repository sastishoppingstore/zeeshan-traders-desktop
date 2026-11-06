/** Zod contracts shared by the Worker and the web app. Money = integer paisa; qty = integer milli-units. */
import { z } from 'zod';
import { BOOKS, CROP_CODES, GOODS_CODES } from './constants.js';

export const paisa = z.number().int().refine(Number.isSafeInteger, 'amount must be a safe integer paisa');
export const milli = z.number().int().refine(Number.isSafeInteger, 'quantity must be a safe integer milli-unit');
// .positive()/.nonnegative() are ZodNumber methods, unavailable after .refine(); use refinements here.
export const positivePaisa = paisa.refine((v) => v > 0, 'amount must be positive');
export const nonnegPaisa = paisa.refine((v) => v >= 0, 'amount must be non-negative');
export const positiveMilli = milli.refine((v) => v > 0, 'quantity must be positive');
export const nonnegMilli = milli.refine((v) => v >= 0, 'quantity must be non-negative');
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
export const ymStr = z.string().regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM');
export const id = z.string().min(1).max(80);
export const optionalId = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v === undefined ? null : v),
  id.nullable().optional()
);
const bookCodes = z.enum(BOOKS.map((b) => b.code) as [string, ...string[]]);
const cropCodes = z.enum([...CROP_CODES] as [string, ...string[]]);
const goodsCodes = z.enum([...GOODS_CODES] as [string, ...string[]]);

export const loginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
  device_id: z.string().max(80).optional(),
  device_name: z.string().max(120).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  setup_token: z.string().min(1),
  owner: z.object({
    name: z.string().min(2).max(120),
    username: z.string().min(3).max(120),
    mobile: z.string().regex(/^03\d{2}[- ]?\d{7}$/, 'Pakistani mobile: 03XX-XXXXXXX'),
    password: z.string().min(10).max(200),
  }),
  business: z.object({
    name_ur: z.string().min(1), name_en: z.string().min(1),
    location_ur: z.string().min(1), phone1: z.string().min(1), phone2: z.string().min(1),
  }).optional(),
  maund_kg: z.number().int().positive().max(100),
  maund_confirmed: z.literal(true),
  opening_balances: z.array(z.object({
    account_code: z.enum(['CASH', 'JAZZ', 'MEEZAN', 'UBL']),
    amount_paisa: paisa,
    as_of_date: dateStr,
    direction: z.enum(['DEBIT', 'CREDIT']),
  })).default([]),
  fiscal_start_month: z.number().int().min(1).max(12).default(7),
  prefixes: z.record(z.string()).optional(),
  regulatory: z.object({
    pesticide_licence_no: z.string().max(80).optional(),
    pesticide_licence_expiry: dateStr.optional(),
    fertilizer_authorisation_no: z.string().max(80).optional(),
    fertilizer_authorisation_expiry: dateStr.optional(),
  }).optional(),
});
export type SetupInput = z.infer<typeof setupSchema>;

export const flexibleBoolean = (defaultVal = false) => z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return defaultVal;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return true;
    if (s === '0' || s === 'false' || s === 'no') return false;
    return Boolean(s);
  }
  return Boolean(v);
}, z.boolean().default(defaultVal));

function cleanProductInput(val: any) {
  if (typeof val !== 'object' || val === null) return val;
  const d = { ...val };
  if (!d.name_ur && d.name_en) d.name_ur = String(d.name_en).trim();
  if (!d.name_en && d.name_ur) d.name_en = String(d.name_ur).trim();
  if (!d.name_ur) d.name_ur = 'نئی مصنوعات';
  if (!d.name_en) d.name_en = d.name_ur;
  if (!d.base_unit || !String(d.base_unit).trim()) d.base_unit = 'kg';
  if (!d.purchase_unit || !String(d.purchase_unit).trim()) d.purchase_unit = d.base_unit;
  if (!d.sale_unit || !String(d.sale_unit).trim()) d.sale_unit = d.base_unit;
  const cr = Number(d.conversion_ratio_milli);
  d.conversion_ratio_milli = cr > 0 ? Math.round(cr) : 1000;
  const boolKeys = ['track_batch', 'track_expiry', 'is_pesticide', 'show_public_price', 'is_published', 'is_featured', 'is_active'] as const;
  for (const b of boolKeys) {
    if (d[b] !== undefined && d[b] !== null) {
      if (typeof d[b] === 'number') d[b] = d[b] !== 0;
      else if (typeof d[b] === 'string') {
        const s = d[b].trim().toLowerCase();
        d[b] = s === '1' || s === 'true' || s === 'yes';
      } else {
        d[b] = Boolean(d[b]);
      }
    }
  }
  if (d.is_pesticide) {
    d.track_batch = true;
    d.track_expiry = true;
  }
  d.purchase_rate_paisa = Math.max(0, Math.round(Number(d.purchase_rate_paisa) || 0));
  d.sale_rate_paisa = Math.max(0, Math.round(Number(d.sale_rate_paisa) || 0));
  d.public_price_paisa = Math.max(0, Math.round(Number(d.public_price_paisa) || 0));
  d.tax_pct_milli = Math.max(0, Math.round(Number(d.tax_pct_milli) || 0));
  d.reorder_level_milli = Math.max(0, Math.round(Number(d.reorder_level_milli) || 0));
  d.grams_per_base_unit = Math.max(0, Math.round(Number(d.grams_per_base_unit) || 0));
  if (!d.brand_id || d.brand_id === '—') d.brand_id = null;
  if (d.availability_mode) {
    const am = String(d.availability_mode).toUpperCase();
    d.availability_mode = ['AUTO', 'ALWAYS', 'CALL'].includes(am) ? am : 'AUTO';
  } else {
    d.availability_mode = 'AUTO';
  }
  if (d.season) {
    const sn = String(d.season).toUpperCase();
    d.season = ['KHARIF', 'RABI', 'NONE'].includes(sn) ? sn : 'NONE';
  } else {
    d.season = 'NONE';
  }
  return d;
}

export const productObjectSchema = z.object({
  name_ur: z.string().min(1).max(160),
  name_en: z.string().max(160).optional().nullable().transform((v) => v ?? ''),
  category_id: z.string().max(80).optional().nullable().transform((v) => (!v || !v.trim() ? '' : v.trim())),
  brand_id: optionalId,
  sku: z.string().max(80).optional().nullable().transform((v) => v ?? ''),
  barcode: z.string().max(80).optional().nullable().transform((v) => v ?? ''),
  slug: z.string().max(180).optional().nullable().transform((v) => (!v || !v.trim() ? undefined : v.trim())),
  description_ur: z.string().max(5000).optional().nullable().transform((v) => v ?? ''),
  description_en: z.string().max(5000).optional().nullable().transform((v) => v ?? ''),
  base_unit: z.string().min(1).max(40).default('kg'),
  purchase_unit: z.string().min(1).max(40).default('kg'),
  sale_unit: z.string().min(1).max(40).default('kg'),
  conversion_ratio_milli: positiveMilli.default(1000),
  grams_per_base_unit: nonnegMilli.default(0),
  track_batch: flexibleBoolean(false),
  track_expiry: flexibleBoolean(false),
  is_pesticide: flexibleBoolean(false),
  reorder_level_milli: nonnegMilli.default(0),
  purchase_rate_paisa: nonnegPaisa.default(0),
  sale_rate_paisa: nonnegPaisa.default(0),
  tax_pct_milli: nonnegMilli.default(0),
  show_public_price: flexibleBoolean(false),
  public_price_paisa: nonnegPaisa.default(0),
  availability_mode: z.enum(['AUTO', 'ALWAYS', 'CALL']).default('AUTO'),
  is_published: flexibleBoolean(false),
  is_featured: flexibleBoolean(false),
  is_active: flexibleBoolean(true),
  seo_title: z.string().max(200).optional().nullable().transform((v) => v ?? ''),
  seo_description: z.string().max(400).optional().nullable().transform((v) => v ?? ''),
  season: z.enum(['KHARIF', 'RABI', 'NONE']).default('NONE'),
});

export const productSchema = z.preprocess(cleanProductInput, productObjectSchema);
export const productUpdateSchema = z.preprocess((val: any) => {
  if (typeof val !== 'object' || val === null) return val;
  const d = { ...val };
  const boolKeys = ['track_batch', 'track_expiry', 'is_pesticide', 'show_public_price', 'is_published', 'is_featured', 'is_active'] as const;
  for (const b of boolKeys) {
    if (d[b] !== undefined && d[b] !== null) {
      if (typeof d[b] === 'number') d[b] = d[b] !== 0;
      else if (typeof d[b] === 'string') {
        const s = d[b].trim().toLowerCase();
        d[b] = s === '1' || s === 'true' || s === 'yes';
      } else {
        d[b] = Boolean(d[b]);
      }
    }
  }
  if (d.conversion_ratio_milli !== undefined) {
    const cr = Number(d.conversion_ratio_milli);
    d.conversion_ratio_milli = cr > 0 ? Math.round(cr) : 1000;
  }
  if (d.purchase_rate_paisa !== undefined) d.purchase_rate_paisa = Math.max(0, Math.round(Number(d.purchase_rate_paisa) || 0));
  if (d.sale_rate_paisa !== undefined) d.sale_rate_paisa = Math.max(0, Math.round(Number(d.sale_rate_paisa) || 0));
  if (d.public_price_paisa !== undefined) d.public_price_paisa = Math.max(0, Math.round(Number(d.public_price_paisa) || 0));
  if (d.tax_pct_milli !== undefined) d.tax_pct_milli = Math.max(0, Math.round(Number(d.tax_pct_milli) || 0));
  if (d.reorder_level_milli !== undefined) d.reorder_level_milli = Math.max(0, Math.round(Number(d.reorder_level_milli) || 0));
  if (d.grams_per_base_unit !== undefined) d.grams_per_base_unit = Math.max(0, Math.round(Number(d.grams_per_base_unit) || 0));
  if (d.brand_id !== undefined && (!d.brand_id || d.brand_id === '—')) d.brand_id = null;
  if (d.availability_mode !== undefined) {
    const am = String(d.availability_mode).toUpperCase();
    d.availability_mode = ['AUTO', 'ALWAYS', 'CALL'].includes(am) ? am : 'AUTO';
  }
  if (d.season !== undefined) {
    const sn = String(d.season).toUpperCase();
    d.season = ['KHARIF', 'RABI', 'NONE'].includes(sn) ? sn : 'NONE';
  }
  return d;
}, productObjectSchema.partial());
export type ProductInput = z.infer<typeof productSchema>;

export const categorySchema = z.object({
  code: z.string().min(1).max(30), name_ur: z.string().min(1), name_en: z.string().default(''),
  slug: z.string().min(1), parent_id: optionalId, book_code: bookCodes.optional(),
  icon: z.string().optional(), sort: z.number().int().default(0), is_active: flexibleBoolean(true),
});
export const brandSchema = z.preprocess((val: any) => {
  if (typeof val !== 'object' || val === null) return val;
  const d = { ...val };
  if (!d.name_ur && d.name_en) d.name_ur = String(d.name_en).trim();
  if (!d.name_en && d.name_ur) d.name_en = String(d.name_ur).trim();
  if (!d.name_ur) d.name_ur = 'عام برانڈ';
  if (!d.name_en) d.name_en = d.name_ur;
  if (d.is_active === undefined) d.is_active = true;
  return d;
}, z.object({ name_ur: z.string().min(1), name_en: z.string().default(''), is_active: flexibleBoolean(true) }));

export const partySchema = z.preprocess((val: any) => {
  if (typeof val !== 'object' || val === null) return val;
  const d = { ...val };
  if (!d.name_ur && d.name_en) d.name_ur = String(d.name_en).trim();
  if (!d.name_en && d.name_ur) d.name_en = String(d.name_ur).trim();
  if (!d.name_ur) d.name_ur = 'فریق';
  if (!d.name_en) d.name_en = d.name_ur;
  d.phone = d.phone ? String(d.phone).trim() : '';
  d.village = d.village ? String(d.village).trim() : '';
  d.notes = d.notes ? String(d.notes).trim() : '';
  d.type = d.type || 'CUSTOMER';
  d.opening_balance_paisa = Math.round(Number(d.opening_balance_paisa) || 0);
  d.credit_limit_paisa = Math.max(0, Math.round(Number(d.credit_limit_paisa) || 0));
  return d;
}, z.object({
  name_ur: z.string().min(1).max(160), name_en: z.string().max(160).default(''),
  phone: z.string().max(30).default(''), village: z.string().max(200).default(''),
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'FARMER', 'EMPLOYEE']),
  opening_balance_paisa: paisa.default(0),
  opening_direction: z.enum(['RECEIVABLE', 'PAYABLE']).default('RECEIVABLE'),
  opening_date: dateStr.optional(),
  credit_limit_paisa: nonnegPaisa.default(0),
  cnic: z.string().max(30).optional().nullable().transform((v) => v || undefined),
  notes: z.string().max(1000).default(''),
  is_active: flexibleBoolean(true),
}));
export type PartyInput = z.infer<typeof partySchema>;

const paymentPart = z.object({ account_id: id, amount_paisa: nonnegPaisa });
const docLine = z.object({
  product_id: id,
  qty_milli: positiveMilli,
  rate_paisa: nonnegPaisa,
  discount_paisa: nonnegPaisa.default(0),
  batch_id: id.nullable().optional(),
  batch_no: z.string().max(80).optional(),
  mfg_date: dateStr.optional(),
  expiry_date: dateStr.optional(),
  bags: z.number().int().nonnegative().optional(),
  weight_per_bag_grams: z.number().int().nonnegative().optional(),
  manufacturer: z.string().max(120).optional(),
  unit_cost_paisa: nonnegPaisa.optional(),
});

const docBase = {
  date: dateStr,
  book_code: bookCodes,
  party_id: id.nullable().optional(),
  party_name: z.string().max(160).optional(), // inline create
  party_phone: z.string().max(30).optional(),
  party_address: z.string().max(300).optional(),
  cnic: z.string().max(30).optional(),
  season: z.enum(['KHARIF', 'RABI', 'NONE']).default('NONE'),
  lines: z.array(docLine).min(1).max(60),
  discount_paisa: nonnegPaisa.default(0),
  freight_paisa: nonnegPaisa.default(0),
  loading_paisa: nonnegPaisa.default(0),
  other_paisa: nonnegPaisa.default(0),
  payments: z.array(paymentPart).max(4).default([]),
  note: z.string().max(1000).default(''),
  supplier_invoice_no: z.string().max(80).optional(),
  idempotency_key: z.string().max(100).optional(),
  offline: z.boolean().default(false),
  quick: z.boolean().default(false),
  status: z.enum(['POSTED', 'DRAFT']).default('POSTED'),
};

export const purchaseSchema = z.object(docBase);
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export const saleSchema = z.object(docBase);
export type SaleInput = z.infer<typeof saleSchema>;

export const grainPurchaseSchema = z.object({
  crop: cropCodes, date: dateStr,
  party_id: id.nullable().optional(), party_name: z.string().max(160).optional(),
  party_phone: z.string().max(30).optional(), village: z.string().max(200).optional(),
  grade: z.string().max(80).default(''), lot_no: z.string().max(80).optional(),
  gross_grams: z.number().int().positive(),
  bags: z.number().int().nonnegative().default(0),
  tare_per_bag_grams: z.number().int().nonnegative().default(0),
  deductions: z.array(z.object({
    type: z.enum(['MOISTURE', 'CLEANING', 'OTHER']),
    basis: z.enum(['weight_grams', 'percent_milli']),
    value: z.number().int().nonnegative(), note: z.string().max(200).optional(),
  })).default([]),
  rate_basis: z.enum(['PER_MAUND', 'PER_KG']).default('PER_MAUND'),
  rate_paisa: nonnegPaisa,
  commission_paisa: nonnegPaisa.default(0),
  labour_paisa: nonnegPaisa.default(0),
  transport_paisa: nonnegPaisa.default(0),
  payments: z.array(paymentPart).max(4).default([]),
  note: z.string().max(1000).default(''),
  idempotency_key: z.string().max(100).optional(), offline: z.boolean().default(false),
});
export type GrainPurchaseInput = z.infer<typeof grainPurchaseSchema>;

export const grainSaleSchema = z.object({
  crop: cropCodes, date: dateStr,
  party_id: id.nullable().optional(), party_name: z.string().max(160).optional(),
  party_phone: z.string().max(30).optional(), village: z.string().max(200).optional(),
  lot_id: id, grade: z.string().max(80).default(''),
  net_grams: z.number().int().positive(),
  rate_basis: z.enum(['PER_MAUND', 'PER_KG']).default('PER_MAUND'),
  rate_paisa: nonnegPaisa,
  deductions_paisa: nonnegPaisa.default(0),
  expenses_paisa: nonnegPaisa.default(0),
  payments: z.array(paymentPart).max(4).default([]),
  note: z.string().max(1000).default(''),
  idempotency_key: z.string().max(100).optional(), offline: z.boolean().default(false),
});
export type GrainSaleInput = z.infer<typeof grainSaleSchema>;

export const receiptSchema = z.object({
  date: dateStr, party_id: id, amount_paisa: positivePaisa,
  account_id: id, reference: z.string().max(100).default(''), note: z.string().max(500).default(''),
  allocate: z.enum(['AUTO', 'MANUAL', 'ADVANCE']).default('AUTO'),
  allocations: z.array(z.object({ invoice_id: id, amount_paisa: positivePaisa })).default([]),
  idempotency_key: z.string().max(100).optional(), offline: z.boolean().default(false),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;
export const paymentSchema = receiptSchema.extend({ payee_type: z.enum(['SUPPLIER', 'FARMER', 'EMPLOYEE', 'CUSTOMER']).default('SUPPLIER') });
export type PaymentInput = z.infer<typeof paymentSchema>;

export const transferSchema = z.object({
  date: dateStr, from_account_id: id, to_account_id: id,
  amount_paisa: positivePaisa, note: z.string().max(500).default(''),
  idempotency_key: z.string().max(100).optional(),
});
export const jazzSchema = z.object({
  date: dateStr, direction: z.enum(['IN', 'OUT']), amount_paisa: positivePaisa,
  counterparty: z.string().min(1).max(160), mobile: z.string().max(30).default(''),
  tid: z.string().max(100).default(''), fee_paisa: nonnegPaisa.default(0),
  purpose: z.enum(['SALE', 'COLLECTION', 'SUPPLIER_PAYMENT', 'OTHER']).default('OTHER'),
  party_id: id.nullable().optional(), note: z.string().max(500).default(''),
});
export const expenseSchema = z.object({
  date: dateStr, category_code: z.string().min(1), vendor: z.string().max(160).default(''),
  amount_paisa: positivePaisa, account_id: id, note: z.string().max(500).default(''),
  idempotency_key: z.string().max(100).optional(), offline: z.boolean().default(false),
});
export const employeeSchema = z.object({
  name: z.string().min(1).max(160), role: z.string().max(100).default(''),
  phone: z.string().max(30).default(''), join_date: dateStr, base_salary_paisa: nonnegPaisa,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
export const advanceSchema = z.object({
  employee_id: id, date: dateStr, amount_paisa: positivePaisa, account_id: id, note: z.string().max(300).default(''),
});
export const payrollSchema = z.object({
  ym: ymStr, pay_date: dateStr, account_id: id,
  rows: z.array(z.object({
    employee_id: id, gross_paisa: nonnegPaisa, advance_recovered_paisa: nonnegPaisa.default(0),
    deductions_paisa: nonnegPaisa.default(0),
  })).min(1),
});
export const returnSchema = z.object({
  type: z.enum(['SALE', 'PURCHASE']), original_id: id, date: dateStr, reason: z.string().min(2).max(500),
  refund_method: z.enum(['ACCOUNT', 'KHATA']).default('KHATA'), account_id: id.optional(),
  lines: z.array(z.object({ line_id: id, qty_milli: positiveMilli })).min(1),
});
export const stockAdjustmentSchema = z.object({
  date: dateStr, product_id: id, batch_id: id.nullable().optional(),
  delta_milli: z.number().int(), reason: z.string().min(2).max(500),
  unit_cost_paisa: nonnegPaisa.default(0),
});
export const stockOpeningSchema = z.object({
  date: dateStr, product_id: id, batch_no: z.string().max(80).optional(),
  qty_milli: positiveMilli, unit_cost_paisa: nonnegPaisa, reason: z.string().max(300).optional(),
});
export const stockCountSchema = z.object({
  date: dateStr, book_code: bookCodes.optional(), reason: z.string().min(2),
  lines: z.array(z.object({ product_id: id, counted_milli: nonnegMilli })).min(1),
});
export const manualJournalSchema = z.object({
  date: dateStr, memo_ur: z.string().min(2).max(500), reason: z.string().min(2).max(500),
  lines: z.array(z.object({
    account_code: z.string().min(4).max(6), debit_paisa: nonnegPaisa,
    credit_paisa: nonnegPaisa, party_id: id.nullable().optional(), book_code: bookCodes.nullable().optional(),
  })).min(2),
});
export const enquirySchema = z.object({
  customer_name: z.string().min(2).max(160), mobile: z.string().regex(/^03\d{2}[- ]?\d{7}$/),
  city: z.string().min(1).max(200), message: z.string().max(2000).default(''),
  consent: z.literal(true),
  items: z.array(z.object({ product_id: id.optional(), qty_milli: nonnegMilli.default(0), unit: z.string().max(40).default('') })).max(30).default([]),
  honeypot: z.string().max(0).default(''),
  elapsed_ms: z.number().int().min(0).default(0),
});
export const cmsPageSchema = z.object({
  slug: z.string().min(1), title_ur: z.string().min(1), title_en: z.string().default(''),
  body_ur: z.string().default(''), body_en: z.string().default(''),
  status: z.enum(['DRAFT', 'PUBLISHED', 'REVIEW_REQUIRED']).default('REVIEW_REQUIRED'),
});
export const bannerSchema = z.object({
  title_ur: z.string().min(1), image_r2_key: z.string().default(''), sort: z.number().int().default(0),
  is_active: z.boolean().default(true), active_from: dateStr.optional(), active_to: dateStr.optional(),
});
export const announcementSchema = z.object({
  title_ur: z.string().min(1), body_ur: z.string().default(''), publish_at: dateStr, is_active: z.boolean().default(true),
});
export const settingsSchema = z.object({ key: z.string().min(1), value: z.unknown() });
export const roleSchema = z.object({ username: z.string().min(3), password: z.string().min(10), name: z.string().min(2), mobile: z.string().max(30).default(''), role_codes: z.array(z.string()).min(1) });
export const syncOperationSchema = z.object({
  idempotency_key: z.string().min(8).max(100), device_id: z.string().min(1).max(80),
  type: z.enum(['SALE', 'PURCHASE', 'GRAIN_PURCHASE', 'GRAIN_SALE', 'RECEIPT', 'PAYMENT', 'EXPENSE', 'PARTY']),
  payload: z.record(z.unknown()), local_time: z.string().min(1),
});
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export const periodCloseSchema = z.object({ ym: ymStr, reason: z.string().min(2) });
export const reconcileSchema = z.object({
  account_id: id, period: ymStr, statement_balance_paisa: paisa,
  matched_txn_ids: z.array(id).default([]), note: z.string().max(300).default(''),
});
export const importSchema = z.object({
  rows: z.array(z.record(z.string())).min(1).max(1000),
  mode: z.enum(['SKIP', 'UPDATE']).default('SKIP'),
});

// --------------------------------- Checkout ---------------------------------
/** Admin-maintained payment instructions. Account/QR details are owner-entered, never invented. */
export const paymentMethodSchema = z.object({
  kind: z.enum(['BANK', 'EASYPAISA', 'JAZZCASH', 'WALLET', 'CASH']),
  title_ur: z.string().min(1).max(120),
  title_en: z.string().max(120).optional().nullable().transform((v) => v ?? ''),
  bank_name: z.string().max(120).optional().nullable().transform((v) => v ?? ''),
  account_title: z.string().max(160).optional().nullable().transform((v) => v ?? ''),
  account_number: z.string().max(40).optional().nullable().transform((v) => v ?? ''),
  iban: z.string().max(40).optional().nullable().transform((v) => v ?? ''),
  mobile_number: z.string().max(30).optional().nullable().transform((v) => v ?? ''),
  instructions_ur: z.string().max(600).optional().nullable().transform((v) => v ?? ''),
  account_id: optionalId,
  is_active: flexibleBoolean(true),
  sort: z.number().int().default(0),
});
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;

/** Checkout never accepts a price — the server prices every line from the catalogue. */
export const checkoutSchema = z.object({
  customer_name: z.string().min(2).max(160), mobile: z.string().regex(/^03\d{2}[- ]?\d{7}$/),
  city: z.string().min(1).max(200), address: z.string().max(300).default(''),
  notes: z.string().max(1000).default(''),
  payment_method_id: id,
  items: z.array(z.object({ product_id: id, qty_milli: positiveMilli })).min(1).max(30),
  consent: z.literal(true),
  honeypot: z.string().max(0).default(''),
  elapsed_ms: z.number().int().min(0).default(0),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Customer looks up / mutates their own order with the one-time token checkout returned. */
export const orderTokenSchema = z.object({ token: z.string().min(16).max(120) });

export const proofSchema = z.object({
  token: z.string().min(16).max(120),
  method: z.string().max(80).default(''),
  sender_reference: z.string().max(80).default(''),
  amount_paisa: nonnegPaisa.default(0),
  data_url: z.string().max(4 * 1024 * 1024),
  honeypot: z.string().max(0).default(''),
  elapsed_ms: z.number().int().min(0).default(0),
});
export type ProofInput = z.infer<typeof proofSchema>;

export const orderDecisionSchema = z.object({
  paid: flexibleBoolean(true),
  mark_proof_accepted: flexibleBoolean(true),
  note: z.string().max(500).default(''),
  idempotency_key: z.string().max(100).optional(),
});
export const orderRejectSchema = z.object({ reason: z.string().min(3).max(500) });

export const goodsBook = goodsCodes;
export const cropBook = cropCodes;
