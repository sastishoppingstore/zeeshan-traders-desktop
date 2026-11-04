/**
 * H1 quantity rule (ONE rule, used everywhere):
 *   All stock quantities are INTEGER MILLI-UNITS of the product's declared base unit.
 *   1 base unit = 1000 milli-units. When base unit = kg, 1 milli-unit = 1 gram,
 *   so weight in grams IS qty_milli. Conversions between units are explicit,
 *   owner-entered integer ratios in milli-units (never assumed).
 * Grain weights are integer grams and therefore also qty_milli for kg-based crops.
 */
export const MILLI = 1000;

export function toMilli(value: string | number): number {
  const raw = String(value).trim().replace(/[\s,_]/g, '');
  if (!/^-?\d*(\.\d{0,3})?$/.test(raw) || raw === '' || raw === '-') {
    throw new Error(`Invalid quantity: ${String(value)}`);
  }
  const neg = raw.startsWith('-');
  const [w = '0', f = ''] = (neg ? raw.slice(1) : raw).split('.');
  const n = BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3));
  const out = Number(neg ? -n : n);
  if (!Number.isSafeInteger(out)) throw new Error('Quantity out of safe range');
  return out;
}

export function fromMilli(milli: number): string {
  if (!Number.isSafeInteger(milli)) throw new Error('quantity must be integer milli-units');
  const neg = milli < 0;
  const n = BigInt(Math.abs(milli));
  const whole = n / 1000n;
  const frac = n % 1000n;
  const fracStr = frac === 0n ? '' : '.' + String(frac).padStart(3, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + fracStr;
}

export function formatQty(milli: number, unitUr = ''): string {
  const s = fromMilli(milli);
  return unitUr ? `${s} ${unitUr}` : s;
}

/** grams -> milli-kg (identity, documented above). */
export const gramsToMilliKg = (grams: number) => {
  if (!Number.isSafeInteger(grams)) throw new Error('grams must be an integer');
  return grams;
};

/** Explicit unit conversion: qty in `from` milli-units -> qty in base milli-units. */
export function applyConversion(qtyMilli: number, ratioMilli: number): number {
  if (!Number.isSafeInteger(qtyMilli) || !Number.isSafeInteger(ratioMilli) || ratioMilli <= 0) {
    throw new Error('invalid unit conversion');
  }
  const num = BigInt(qtyMilli) * BigInt(ratioMilli);
  const q = num / 1000n;
  const r = num % 1000n;
  return Number(q + (r * 2n >= 1000n ? 1n : 0n));
}

export interface Deduction {
  type: 'MOISTURE' | 'CLEANING' | 'OTHER';
  basis: 'weight_grams' | 'percent_milli'; // percent_milli: 1000 = 1%
  value: number; // integer grams, or integer percent_milli
  note?: string;
}

export interface NetWeightResult {
  grossGrams: number;
  tareGrams: number;
  deductionLines: { type: Deduction['type']; grams: number; note?: string }[];
  deductionGrams: number;
  netGrams: number;
  arithmetic: string[]; // human-readable, line by line (Urdu labels added by UI)
}

/**
 * Grain weighment: gross - tare - deductions = net (all INTEGER grams).
 * Percentage deductions are computed on gross weight with exact integer arithmetic.
 * "percent_milli": 1000 = 1%, e.g. 2500 = 2.5%.
 */
export function netWeight(input: {
  grossGrams: number;
  bags?: number;
  tarePerBagGrams?: number;
  deductions?: Deduction[];
}): NetWeightResult {
  const { grossGrams } = input;
  if (!Number.isSafeInteger(grossGrams) || grossGrams <= 0) throw new Error('gross weight must be a positive integer number of grams');
  const bags = input.bags ?? 0;
  const tarePerBag = input.tarePerBagGrams ?? 0;
  if (!Number.isSafeInteger(bags) || bags < 0 || !Number.isSafeInteger(tarePerBag) || tarePerBag < 0) {
    throw new Error('invalid bag/tare values');
  }
  const tareGrams = bags * tarePerBag;
  const lines = (input.deductions ?? []).map((d) => {
    let grams: number;
    if (d.basis === 'weight_grams') {
      grams = d.value;
    } else {
      const num = BigInt(grossGrams) * BigInt(d.value);
      const q = num / 100000n;
      const r = num % 100000n;
      grams = Number(q + (r * 2n >= 100000n ? 1n : 0n));
    }
    if (!Number.isSafeInteger(grams) || grams < 0) throw new Error('invalid deduction');
    return { type: d.type, grams, note: d.note };
  });
  const deductionGrams = lines.reduce((a, b) => a + b.grams, 0);
  const netGrams = grossGrams - tareGrams - deductionGrams;
  if (netGrams <= 0) throw new Error('net weight must be positive (check tare and deductions)');
  const arithmetic = [
    `gross=${grossGrams}g`,
    `tare=${bags}×${tarePerBag}=${tareGrams}g`,
    ...lines.map((l, i) => `deduction[${i + 1}] ${l.type}=${l.grams}g`),
    `net=${grossGrams}-${tareGrams}-${deductionGrams}=${netGrams}g`,
  ];
  return { grossGrams, tareGrams, deductionLines: lines, deductionGrams, netGrams, arithmetic };
}

/** "5 من 12 کلو" style. maundKg is an OWNER setting; never assumed. */
export function formatMaund(netGrams: number, maundKg: number): string {
  if (!Number.isSafeInteger(maundKg) || maundKg <= 0) throw new Error('maund kg is not configured');
  const maundGrams = maundKg * 1000;
  const maunds = Math.floor(netGrams / maundGrams);
  let rest = netGrams - maunds * maundGrams;
  const kg = Math.floor(rest / 1000);
  rest -= kg * 1000;
  const parts: string[] = [];
  if (maunds) parts.push(`${maunds} من`);
  if (kg) parts.push(`${kg} کلو`);
  if (rest) parts.push(`${rest} گرام`);
  return parts.length ? parts.join(' ') : '0';
}

/** Rate per maund -> rate per kg (paisa), exact integer. */
export function ratePerMaundToRatePerKg(ratePaisaPerMaund: number, maundKg: number): number {
  if (!Number.isSafeInteger(maundKg) || maundKg <= 0) throw new Error('maund kg is not configured');
  const num = BigInt(ratePaisaPerMaund);
  const den = BigInt(maundKg);
  const q = num / den;
  const r = num % den;
  return Number(q + (r * 2n >= den ? 1n : 0n));
}
