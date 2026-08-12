import { evaluateInstantBankDiscount, DEFAULT_BANK_RULES } from '../src/engines/instantBankDiscount';

describe('evaluateInstantBankDiscount', () => {
  it('grants 10% capped discount for HDFC on a large cart', () => {
    const result = evaluateInstantBankDiscount({
      cardBin: '400123',
      cartValuePaise: 20_00_000, // ₹20,000
    });
    expect(result.eligible).toBe(true);
    expect(result.bankId).toBe('HDFC');
    // 10% of ₹20,000 = ₹2,000, but cap is ₹1500 -> discount should be capped
    expect(result.discountPaise).toBe(1_50_000);
    expect(result.finalPricePaise).toBe(20_00_000 - 1_50_000);
  });

  it('grants uncapped 10% discount for HDFC when below the cap', () => {
    const result = evaluateInstantBankDiscount({
      cardBin: '400123',
      cartValuePaise: 6_00_000, // ₹6,000
    });
    expect(result.eligible).toBe(true);
    expect(result.discountPaise).toBe(60_000); // 10% of ₹6,000 = ₹600
  });

  it('rejects a cart below the bank minimum', () => {
    const result = evaluateInstantBankDiscount({
      cardBin: '411111',
      cartValuePaise: 100_00, // ₹100, below ICICI min of ₹2000
    });
    expect(result.eligible).toBe(false);
    expect(result.bankId).toBe('ICICI');
    expect(result.discountPaise).toBe(0);
  });

  it('rejects a card BIN with no matching bank offer', () => {
    const result = evaluateInstantBankDiscount({
      cardBin: '999999',
      cartValuePaise: 50_00_000,
    });
    expect(result.eligible).toBe(false);
    expect(result.bankId).toBeUndefined();
    expect(result.finalPricePaise).toBe(50_00_000);
  });

  it('is a pure function: same input always yields same output', () => {
    const req = { cardBin: '400123', cartValuePaise: 7_50_000 };
    const r1 = evaluateInstantBankDiscount(req, DEFAULT_BANK_RULES);
    const r2 = evaluateInstantBankDiscount(req, DEFAULT_BANK_RULES);
    expect(r1).toEqual(r2);
  });
});
