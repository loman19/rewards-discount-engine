import { NoCostEmiRequest, NoCostEmiResult } from '../types';

/**
 * No Cost EMI.
 *
 * "No cost" doesn't mean interest-free financing exists for free — it means
 * the *customer* pays zero interest, and the platform/merchant absorbs the
 * interest cost instead (usually funded from the margin on the sale, or
 * jointly subsidized with the bank).
 *
 * This module computes:
 *   - what the customer actually pays per month (principal / tenure, no interest)
 *   - what the "true" EMI would have been if interest were charged
 *   - the difference — i.e. how much the platform is subsidizing
 *
 * A single-request sustainability guard is included (per-transaction subsidy
 * cap) — a full cross-request promotional-budget tracker is a natural next
 * iteration on top of this.
 */

// Per-transaction guard: don't let a single order's subsidy exceed this,
// regardless of tenure/rate combination. Prevents a misconfigured tenure
// or rate from creating an unbounded liability on one order.
const MAX_SUBSIDY_PAISE_PER_ORDER = 2_00_000; // ₹2000

export function evaluateNoCostEmi(request: NoCostEmiRequest): NoCostEmiResult {
  const { cartValuePaise, tenureMonths, annualInterestRatePercent } = request;

  if (tenureMonths <= 0) {
    throw new Error('tenureMonths must be a positive integer.');
  }

  // Customer pays exactly principal / tenure per month — no interest.
  const emiPaisePerMonth = Math.round(cartValuePaise / tenureMonths);
  const totalCustomerPaysPaise = emiPaisePerMonth * tenureMonths;

  // "True" EMI using standard reducing-balance formula, to work out what the
  // customer *would* have paid, so we know how much interest we're absorbing.
  const monthlyRate = annualInterestRatePercent / 12 / 100;
  const trueEmiPaisePerMonth =
    monthlyRate === 0
      ? cartValuePaise / tenureMonths
      : (cartValuePaise * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
        (Math.pow(1 + monthlyRate, tenureMonths) - 1);

  const trueTotalPaise = trueEmiPaisePerMonth * tenureMonths;
  const interestSubsidyPaise = Math.max(0, Math.round(trueTotalPaise - cartValuePaise));

  return {
    tenureMonths,
    emiPaisePerMonth,
    totalCustomerPaysPaise,
    interestSubsidyPaise,
    sustainable: interestSubsidyPaise <= MAX_SUBSIDY_PAISE_PER_ORDER,
  };
}
