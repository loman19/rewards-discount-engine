import { evaluateNoCostEmi } from '../src/engines/noCostEmi';

describe('evaluateNoCostEmi', () => {
  it('splits the cart value evenly across tenure with zero interest to the customer', () => {
    const result = evaluateNoCostEmi({
      cartValuePaise: 12_00_000, // ₹12,000
      tenureMonths: 6,
      annualInterestRatePercent: 14,
    });

    expect(result.emiPaisePerMonth).toBe(200_000); // ₹2000/month
    expect(result.totalCustomerPaysPaise).toBe(12_00_000);
  });

  it('computes a positive interest subsidy when the bank rate is above zero', () => {
    const result = evaluateNoCostEmi({
      cartValuePaise: 12_00_000,
      tenureMonths: 6,
      annualInterestRatePercent: 14,
    });

    expect(result.interestSubsidyPaise).toBeGreaterThan(0);
  });

  it('reports zero subsidy when the annual interest rate is zero', () => {
    const result = evaluateNoCostEmi({
      cartValuePaise: 12_00_000,
      tenureMonths: 6,
      annualInterestRatePercent: 0,
    });

    expect(result.interestSubsidyPaise).toBe(0);
    expect(result.sustainable).toBe(true);
  });

  it('flags an order as unsustainable if the subsidy exceeds the per-order cap', () => {
    const result = evaluateNoCostEmi({
      cartValuePaise: 500_00_000, // ₹5,00,000 — a very large ticket item
      tenureMonths: 24,
      annualInterestRatePercent: 18,
    });

    expect(result.interestSubsidyPaise).toBeGreaterThan(2_00_000);
    expect(result.sustainable).toBe(false);
  });

  it('throws on a non-positive tenure', () => {
    expect(() =>
      evaluateNoCostEmi({ cartValuePaise: 10_000_00, tenureMonths: 0, annualInterestRatePercent: 10 })
    ).toThrow();
  });
});
