/**
 * Shared domain types for the Rewards & Discount Engine.
 *
 * These map to the three customer-facing levers named in the target JD
 * (Amazon Pay India — Rewards Team):
 *   1. Instant Bank Discount
 *   2. No Cost EMI
 *   3. Exchange Discount
 */

export interface BankBinRule {
  bankId: string;
  binPrefixes: string[]; // card BIN prefixes eligible for this bank's offer
  discountPercent: number; // e.g. 10 => 10%
  maxDiscountPaise: number; // cap, in paise, to bound liability per transaction
  minCartValuePaise: number;
}

export interface InstantBankDiscountRequest {
  cardBin: string; // first 6 digits of card number
  cartValuePaise: number;
}

export interface InstantBankDiscountResult {
  eligible: boolean;
  bankId?: string;
  discountPaise: number;
  finalPricePaise: number;
  reason?: string;
}

export interface NoCostEmiRequest {
  cartValuePaise: number;
  tenureMonths: number;
  annualInterestRatePercent: number; // the *real* bank interest rate
}

export interface NoCostEmiResult {
  tenureMonths: number;
  emiPaisePerMonth: number; // what the customer actually pays per month
  totalCustomerPaysPaise: number; // should equal cartValuePaise (no-cost = customer pays no interest)
  interestSubsidyPaise: number; // the interest amount merchant/platform absorbs
  sustainable: boolean; // false if subsidy exceeds configured cap
}

export type DeviceCategory = 'phone' | 'laptop' | 'tablet' | 'smartwatch';
export type DeviceCondition = 'excellent' | 'good' | 'fair' | 'poor';

export interface ExchangeDiscountRequest {
  deviceCategory: DeviceCategory;
  ageMonths: number;
  condition: DeviceCondition;
  originalPricePaise: number;
}

export interface ExchangeDiscountResult {
  estimatedValuePaise: number;
  discountAppliedPaise: number;
  depreciationPercentApplied: number;
}

/** Generic envelope so all three engines can share one idempotency layer. */
export interface EngineRequest<T> {
  idempotencyKey: string;
  payload: T;
}
