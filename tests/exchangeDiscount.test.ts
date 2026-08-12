import { evaluateExchangeDiscount } from '../src/engines/exchangeDiscount';

describe('evaluateExchangeDiscount', () => {
  it('values a near-new phone in excellent condition close to original price', () => {
    const result = evaluateExchangeDiscount({
      deviceCategory: 'phone',
      ageMonths: 1,
      condition: 'excellent',
      originalPricePaise: 50_000_00, // ₹50,000
    });

    // ~3% depreciation for 1 month, no condition penalty (excellent = 1.0x)
    expect(result.depreciationPercentApplied).toBeCloseTo(3, 1);
    expect(result.estimatedValuePaise).toBeGreaterThan(47_000_00);
  });

  it('applies a heavier discount for an old device in poor condition', () => {
    const result = evaluateExchangeDiscount({
      deviceCategory: 'phone',
      ageMonths: 24,
      condition: 'poor',
      originalPricePaise: 50_000_00,
    });

    expect(result.estimatedValuePaise).toBeLessThan(10_000_00);
  });

  it('never depreciates a category below its residual value floor from age alone', () => {
    const result = evaluateExchangeDiscount({
      deviceCategory: 'laptop',
      ageMonths: 120, // very old, well past 100% depreciation on raw curve
      condition: 'excellent',
      originalPricePaise: 100_000_00,
    });

    // laptop floor is 10%, condition multiplier for excellent is 1.0
    expect(result.depreciationPercentApplied).toBe(90);
    expect(result.estimatedValuePaise).toBe(10_000_00);
  });

  it('applies the condition multiplier on top of depreciation', () => {
    const excellent = evaluateExchangeDiscount({
      deviceCategory: 'tablet',
      ageMonths: 6,
      condition: 'excellent',
      originalPricePaise: 20_000_00,
    });
    const fair = evaluateExchangeDiscount({
      deviceCategory: 'tablet',
      ageMonths: 6,
      condition: 'fair',
      originalPricePaise: 20_000_00,
    });

    expect(fair.estimatedValuePaise).toBeLessThan(excellent.estimatedValuePaise);
  });
});
