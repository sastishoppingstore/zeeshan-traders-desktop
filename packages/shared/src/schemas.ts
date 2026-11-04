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

export const productSchema = z.object({
  name_ur: z.string().min(1).max(160),
  name_en: z.string().max(160).default(''),
  category_id: id,
  brand_id: id.nullable().optional(),
  sku: z.string().max(80).optional().default(''),
  barcode: z.string().max(80).optional().default(''),
  slug: z.string().max(180).optional(),
  description_ur: z.string().max(5000).optional().default(''),
  description_en: z.string().max(5000).optional().default(''),
  base_unit: z.string().min(1).max(40),
  purchase_unit: z.string().min(1).max(40),
  sale_unit: z.string().min(1).max(40),
  conversion_ratio_milli: positiveMilli,
  grams_per_base_unit: nonnegMilli.default(0),
  track_batch: z.boolean().default(false),
  track_expiry: z.boolean().default(false),
  is_pesticide: z.boolean().default(false),
  reorder_level_milli: nonnegMilli.default(0),
  purchase_rate_paisa: nonnegPaisa.default(0),
  sale_rate_paisa: nonnegPaisa.default(0),
  tax_pct_milli: nonnegMilli.default(0),
  show_public_price: z.boolean().default(false),
  public_price_paisa: nonnegPaisa.default(0),
  availability_mode: z.enum(['AUTO', 'ALWAYS', 'CALL']).default('AUTO'),
  is_published: z.boolean().default(false),
  is_featured: z.boolean().default(false),
  is_active: z.boolean().default(true),
  seo_title: z.string().max(200).optional().default(''),
  seo_description: z.string().max(400).optional().default(''),
  season: z.enum(['KHARIF', 'RABI', 'NONE']).default('NONE'),
});
export type ProductInput = z.infer<typeof productSchema>;

export const categorySchema = z.object({
  code: z.string().min(1).max(30), name_ur: z.string().min(1), name_en: z.string().default(''),
  slug: z.string().min(1), parent_id: id.nullable().optional(), book_code: bookCodes.optional(),
  icon: z.string().optional(), sort: z.number().int().default(0), is_active: z.boolean().default(true),
});
export const brandSchema = z.object({ name_ur: z.string().min(1), name_en: z.string().default(''), is_active: z.boolean().default(true) });

export const partySchema = z.object({
  name_ur: z.string().min(1).max(160), name_en: z.string().max(160).default(''),
  phone: z.string().max(30).default(''), village: z.string().max(200).default(''),
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'FARMER', 'EMPLOYEE']),
  opening_balance_paisa: paisa.default(0),
  opening_direction: z.enum(['RECEIVABLE', 'PAYABLE']).default('RECEIVABLE'),
  opening_date: dateStr.optional(),
  credit_limit_paisa: nonnegPaisa.default(0),
  cnic: z.string().max(30).optional(),
  notes: z.string().max(1000).default(''),
  is_active: z.boolean().default(true),
});
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
  title_ur: z.string().min(1).max(120), title_en: z.string().max(120).default(''),
  bank_name: z.string().max(120).default(''), account_title: z.string().max(160).default(''),
  account_number: z.string().max(40).default(''), iban: z.string().max(40).default(''),
  mobile_number: z.string().max(30).default(''), instructions_ur: z.string().max(600).default(''),
  account_id: id.nullable().optional(), is_active: z.boolean().default(true),
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
  paid: z.boolean().default(true),
  mark_proof_accepted: z.boolean().default(true),
  note: z.string().max(500).default(''),
  idempotency_key: z.string().max(100).optional(),
});
export const orderRejectSchema = z.object({ reason: z.string().min(3).max(500) });

export const goodsBook = goodsCodes;
export const cropBook = cropCodes;
