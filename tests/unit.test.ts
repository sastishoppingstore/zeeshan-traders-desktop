import { describe, it, expect } from 'vitest';
import {
  rupeesToPaisa, paisaToRupees, formatPKR, groupPK, sumPaisa, lineAmount,
  allocateProportional, cogsAtWeightedAverage,
  toMilli, fromMilli, netWeight, formatMaund, ratePerMaundToRatePerKg, applyConversion,
  assertBalanced, saleLines, purchaseLines, receiptLines, paymentLines, transferLines,
  expenseLines, chargeLines, salaryLines, saleReturnLines, purchaseReturnLines,
  stockAdjustmentLines, openingBalanceLines, manualJournalLines, RECIPE_NAMES,
  hashPassword, verifyPassword, encryptText, decryptText, seqNumber,
} from '@zt/shared';

describe('H1 — integer paisa money', () => {
  it('parses rupee strings without floats', () => {
    expect(rupeesToPaisa('1,250.50')).toBe(125050);
    expect(rupeesToPaisa('-0.01')).toBe(-1);
    expect(rupeesToPaisa('Rs 125000')).toBe(12500000);
    expect(() => rupeesToPaisa('12.345')).toThrow();
    expect(() => rupeesToPaisa('abc')).toThrow();
  });
  it('formats with Pakistani digit grouping', () => {
    expect(groupPK('12500000')).toBe('1,25,00,000');
    expect(formatPKR(12500000)).toBe('Rs 1,25,000');          // 12,500,000 paisa = 125,000 rupees
    expect(formatPKR(1250000000)).toBe('Rs 1,25,00,000');      // 1.25 crore rupees
    expect(formatPKR(125050)).toBe('Rs 1,250.50');
    expect(paisaToRupees(125050)).toBe('1250.50');
  });
  it('sums and multiplies exactly', () => {
    expect(sumPaisa([1, 2, 3, Number.MAX_SAFE_INTEGER - 6])).toBe(Number.MAX_SAFE_INTEGER);
    expect(lineAmount(1500, 12345)).toBe(18518); // 1.5 * 12345 = 18517.5 -> half-up
    expect(lineAmount(1000, 99999999)).toBe(99999999);
  });
  it('allocates landed cost across lines with an exact integer sum', () => {
    const parts = allocateProportional(1001, [1, 2, 3], 'value');
    expect(sumPaisa(parts)).toBe(1001);
    const negative = allocateProportional(-777, [10, 20, 30], 'weight');
    expect(sumPaisa(negative)).toBe(-777);
    expect(sumPaisa(allocateProportional(0, [1, 1], 'value'))).toBe(0);
  });
  it('weighted-average COGS never overstates inventory value', () => {
    expect(cogsAtWeightedAverage(100000, 10000, 2500)).toBe(25000);
    expect(cogsAtWeightedAverage(100001, 3, 1)).toBe(33334);
    expect(() => cogsAtWeightedAverage(100, 10, 11)).toThrow();
  });
});

describe('H1 — one quantity rule (integer milli-units / grams)', () => {
  it('parses and formats milli-units', () => {
    expect(toMilli('12.5')).toBe(12500);
    expect(toMilli('0.001')).toBe(1);
    expect(fromMilli(12500)).toBe('12.5');
    expect(() => toMilli('1.2345')).toThrow();
    expect(applyConversion(2000, 50000)).toBe(100000); // 2 bags * 50 kg = 100 kg
  });
  it('net weight arithmetic is transparent and integer', () => {
    const w = netWeight({
      grossGrams: 200000, bags: 4, tarePerBagGrams: 1000,
      deductions: [
        { type: 'MOISTURE', basis: 'percent_milli', value: 2500 }, // 2.5% of gross = 5000g
        { type: 'CLEANING', basis: 'weight_grams', value: 2000 },
      ],
    });
    expect(w.tareGrams).toBe(4000);
    expect(w.deductionGrams).toBe(7000);
    expect(w.netGrams).toBe(189000);
    expect(w.arithmetic[w.arithmetic.length - 1]).toBe('net=200000-4000-7000=189000g');
  });
  it('maund conversion requires an owner setting, never an assumption', () => {
    expect(formatMaund(212000, 40)).toBe('5 من 12 کلو');
    expect(ratePerMaundToRatePerKg(400000, 40)).toBe(10000);
    expect(() => formatMaund(1000, 0)).toThrow();
  });
});

describe('H4 — every posting recipe balances', () => {
  const p = (n: number) => Math.round(n * 100);
  const recipes = [
    saleLines({ book: 'FERT', total: p(1000), cost: p(700), payments: [{ account_id: 'CASH', amount_paisa: p(600) }], credit: p(400), party_id: 'p1' }),
    purchaseLines({ book: 'FERT', total: p(900), payments: [{ account_id: 'MEEZAN', amount_paisa: p(300) }], credit: p(600), party_id: 's1' }),
    receiptLines('JAZZ', p(250), 'p1'),
    paymentLines('UBL', p(250), 's1'),
    transferLines('CASH', 'JAZZ', p(500)),
    expenseLines('CASH', p(120), '6040', 'SHOP'),
    chargeLines('JAZZ', p(15)),
    salaryLines('MEEZAN', p(30000), p(5000), p(1000), p(24000)),
    saleReturnLines({ refund: p(200), cost: p(140), creditToKhata: true, party_id: 'p1', book: 'PEST' }),
    purchaseReturnLines({ amount: p(200), creditToKhata: true, party_id: 's1', book: 'PEST' }),
    stockAdjustmentLines(p(50), 'WHEAT'),
    stockAdjustmentLines(-p(50), 'WHEAT'),
    openingBalanceLines('1000', p(10000), 'DEBIT'),
    openingBalanceLines('2000', p(10000), 'CREDIT'),
  ];
  it('all 14 recipe variants have sum(debit) == sum(credit)', () => {
    for (const lines of recipes) expect(() => assertBalanced(lines)).not.toThrow();
    expect(RECIPE_NAMES.length).toBe(13);
  });
  it('rejects unbalanced and malformed journals', () => {
    expect(() => manualJournalLines([
      { account_code: '1000', debit_paisa: 100, credit_paisa: 0 },
      { account_code: '4010', debit_paisa: 0, credit_paisa: 99 },
    ])).toThrow(/UNBALANCED/);
    expect(() => assertBalanced([])).toThrow();
    expect(() => assertBalanced([{ account_code: '1000', debit_paisa: -1, credit_paisa: 0 }])).toThrow();
  });
  it('transfer never touches income/expense accounts', () => {
    const lines = transferLines('CASH', 'UBL', p(1000));
    expect(lines.flatMap((l) => l.account_code)).toEqual(['1030', '1000']);
    expect(() => transferLines('CASH', 'CASH', p(1))).toThrow();
  });
  it('document numbering is zero-padded per sequence', () => {
    expect(seqNumber('FS', 123)).toMatch(/^FS-\d{4}-000123$/);
  });
});

describe('security primitives', () => {
  it('PBKDF2 hashing verifies and rejects wrong passwords', async () => {
    const { hash, salt, iterations } = await hashPassword('a-long-password-123');
    expect(iterations).toBeGreaterThanOrEqual(310_000);
    expect(await verifyPassword('a-long-password-123', hash, salt, iterations)).toBe(true);
    expect(await verifyPassword('wrong', hash, salt, iterations)).toBe(false);
  });
  it('CNIC column encryption round-trips with AES-GCM', async () => {
    const secret = Buffer.alloc(32, 3).toString('base64');
    const enc = await encryptText('35202-1234567-8', secret);
    expect(enc).not.toContain('35202');
    expect(await decryptText(enc, secret)).toBe('35202-1234567-8');
  });
});
