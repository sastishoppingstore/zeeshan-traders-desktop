/**
 * H1: ALL money is INTEGER PAISA. No floating point is used for money anywhere.
 * 1 PKR = 100 paisa. Parsing/formatting is decimal-string based (never Number('1.1')*100).
 */
export type Paisa = number;

export function assertPaisa(v: unknown, label = 'amount'): Paisa {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`${label} must be an integer number of paisa, got ${String(v)}`);
  }
  return v;
}

/** "1,250.50" / "1250.5" / 1250.5 (rupees) -> 125050 paisa. */
export function rupeesToPaisa(value: string | number): Paisa {
  const raw = String(value).trim().replace(/[\s,_]/g, '').replace(/^(Rs|روپے)\.?/i, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(raw) || raw === '' || raw === '-') {
    throw new Error(`Invalid rupee amount: ${String(value)}`);
  }
  const negative = raw.startsWith('-');
  const [whole = '0', frac = ''] = (negative ? raw.slice(1) : raw).split('.');
  const w = BigInt(whole || '0') * 100n;
  const f = BigInt((frac + '00').slice(0, 2));
  const total = (negative ? -1n : 1n) * (w + f);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Amount out of safe integer range');
  }
  return Number(total);
}

export function paisaToRupees(p: Paisa): string {
  assertPaisa(p);
  const sign = p < 0 ? '-' : '';
  const n = BigInt(Math.abs(p));
  return `${sign}${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}

/** Pakistani digit grouping: 12500000 -> "1,25,00,000". */
export function groupPK(value: string | number): string {
  const s = String(value);
  const [whole, frac] = s.split('.');
  const neg = whole.startsWith('-');
  const digits = neg ? whole.slice(1) : whole;
  let out = '';
  if (digits.length > 3) {
    out = digits.slice(-3);
    let rest = digits.slice(0, -3);
    while (rest.length > 2) {
      out = rest.slice(-2) + ',' + out;
      rest = rest.slice(0, -2);
    }
    if (rest) out = rest + ',' + out;
  } else out = digits;
  return (neg ? '-' : '') + out + (frac ? '.' + frac : '');
}

/** "Rs 1,25,000" or "Rs 1,25,000.50" — always LTR-isolated by the caller (unicode-bidi: isolate). */
export function formatPKR(p: Paisa, withDecimals = false): string {
  assertPaisa(p);
  const sign = p < 0 ? '-' : '';
  const abs = BigInt(Math.abs(p));
  const rupees = groupPK((abs / 100n).toString());
  const paisa = abs % 100n;
  const show = withDecimals || paisa !== 0n;
  return `${sign}Rs ${rupees}${show ? '.' + String(paisa).padStart(2, '0') : ''}`;
}

/** Exact integer sum (BigInt internally) to avoid any float accumulation. */
export function sumPaisa(values: Paisa[]): Paisa {
  let t = 0n;
  for (const v of values) t += BigInt(assertPaisa(v));
  const out = Number(t);
  if (!Number.isSafeInteger(out)) throw new Error('Money sum overflow');
  return out;
}

/** qty_milli * rate_paisa_per_base_unit / 1000, rounded half-up, exact via BigInt. */
export function lineAmount(qtyMilli: number, ratePaisaPerBaseUnit: Paisa): Paisa {
  if (!Number.isSafeInteger(qtyMilli)) throw new Error('quantity must be integer milli-units');
  const num = BigInt(qtyMilli) * BigInt(assertPaisa(ratePaisaPerBaseUnit));
  const q = num / 1000n;
  const r = num % 1000n;
  return Number(q + (r * 2n >= 1000n ? 1n : 0n));
}

/**
 * Allocate a total (freight/discount/landed cost) across lines by weight or value.
 * Largest-remainder method on integer paisa: the returned parts sum EXACTLY to total.
 */
export function allocateProportional(total: Paisa, weights: number[], basis: 'weight' | 'value' = 'value'): Paisa[] {
  assertPaisa(total, 'total');
  if (weights.length === 0) return [];
  const safe = weights.map((w) => {
    if (!Number.isFinite(w) || w < 0) throw new Error('weights must be finite non-negative numbers');
    return BigInt(Math.round(w * 1000)); // fixed 3-decimal precision, via integer
  });
  const sum = safe.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    // equal split when no basis is available
    const each = BigInt(total) / BigInt(weights.length);
    const out = weights.map(() => Number(each));
    let rem = total - sumPaisa(out);
    for (let i = 0; rem !== 0; i++, rem -= Math.sign(rem)) out[i % out.length] += Math.sign(rem);
    return out;
  }
  const neg = total < 0;
  const t = BigInt(Math.abs(total));
  const exact = safe.map((w) => (w * t) / sum);
  const rems = safe.map((w, i) => ({ i, r: (w * t) % sum }));
  const out = exact.map(Number);
  let remainder = Number(t - exact.reduce((a, b) => a + b, 0n));
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < remainder; k++) out[rems[k % rems.length].i] += 1;
  return neg ? out.map((v) => -v) : out;
}

/**
 * Weighted average costing without floats: inventory value (paisa) and qty (milli-units)
 * are both integers; the cost of an issue is value * qtyOut / qtyOnHand, rounded half-up.
 */
export function cogsAtWeightedAverage(valuePaisa: Paisa, qtyMilli: number, qtyOutMilli: number): Paisa {
  assertPaisa(valuePaisa, 'inventory value');
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) throw new Error('qty on hand must be positive');
  if (!Number.isSafeInteger(qtyOutMilli) || qtyOutMilli < 0 || qtyOutMilli > qtyMilli) {
    throw new Error('qty out exceeds stock on hand');
  }
  const num = BigInt(valuePaisa) * BigInt(qtyOutMilli);
  const den = BigInt(qtyMilli);
  const q = num / den;
  const r = num % den;
  return Number(q + (r * 2n >= den ? 1n : 0n));
}

/** Split a payment across accounts, exact integer paisa. */
export function splitPayment(total: Paisa, parts: { account_id: string; amount_paisa: Paisa }[]): typeof parts {
  const sum = sumPaisa(parts.map((p) => p.amount_paisa));
  if (sum > total) throw new Error('paid amount exceeds total');
  if (parts.some((p) => p.amount_paisa < 0)) throw new Error('payment parts cannot be negative');
  return parts;
}

export function pctOfPaisa(amount: Paisa, percentMilli: number): Paisa {
  assertPaisa(amount);
  const num = BigInt(amount) * BigInt(Math.round(percentMilli));
  const q = num / 100000n; // percent expressed in per-mille-of-percent (1000 = 1%)
  const r = num % 100000n;
  return Number(q + (r * 2n >= 100000n ? 1n : 0n));
}
