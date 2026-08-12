import {
  ExchangeDiscountRequest,
  InstantBankDiscountRequest,
  NoCostEmiRequest,
} from './types';

/**
 * Manual validation at the API boundary.
 *
 * HTTP bodies aren't type-checked at runtime — TypeScript's compile-time
 * types on Request/Response bodies are a lie once JSON crosses the wire.
 * Without this, a missing or negative field reaches the engines as
 * `undefined`/negative and silently produces NaN/null or nonsensical
 * results (e.g. a trade-in value higher than the device's original price)
 * with a 200 instead of a clean 400.
 *
 * This is deliberately hand-rolled rather than a schema library (zod etc.)
 * — that's scoped as a separate future upgrade; this only closes the gap
 * found in the audit (malformed/missing/negative fields).
 */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateInstantBankDiscountRequest(body: unknown): InstantBankDiscountRequest {
  const b = body as Partial<InstantBankDiscountRequest> | null | undefined;

  if (!b || typeof b !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }
  if (typeof b.cardBin !== 'string' || b.cardBin.trim().length === 0) {
    throw new Error('cardBin is required and must be a non-empty string.');
  }
  if (!isFiniteNumber(b.cartValuePaise) || b.cartValuePaise < 0) {
    throw new Error('cartValuePaise is required and must be a non-negative number.');
  }

  return { cardBin: b.cardBin, cartValuePaise: b.cartValuePaise };
}

export function validateNoCostEmiRequest(body: unknown): NoCostEmiRequest {
  const b = body as Partial<NoCostEmiRequest> | null | undefined;

  if (!b || typeof b !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }
  if (!isFiniteNumber(b.cartValuePaise) || b.cartValuePaise < 0) {
    throw new Error('cartValuePaise is required and must be a non-negative number.');
  }
  if (!isFiniteNumber(b.tenureMonths) || !Number.isInteger(b.tenureMonths) || b.tenureMonths <= 0) {
    throw new Error('tenureMonths is required and must be a positive integer.');
  }
  if (!isFiniteNumber(b.annualInterestRatePercent) || b.annualInterestRatePercent < 0) {
    throw new Error('annualInterestRatePercent is required and must be a non-negative number.');
  }

  return {
    cartValuePaise: b.cartValuePaise,
    tenureMonths: b.tenureMonths,
    annualInterestRatePercent: b.annualInterestRatePercent,
  };
}

const DEVICE_CATEGORIES = ['phone', 'laptop', 'tablet', 'smartwatch'] as const;
const DEVICE_CONDITIONS = ['excellent', 'good', 'fair', 'poor'] as const;

export function validateExchangeDiscountRequest(body: unknown): ExchangeDiscountRequest {
  const b = body as Partial<ExchangeDiscountRequest> | null | undefined;

  if (!b || typeof b !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }
  if (!b.deviceCategory || !DEVICE_CATEGORIES.includes(b.deviceCategory as any)) {
    throw new Error(`deviceCategory is required and must be one of: ${DEVICE_CATEGORIES.join(', ')}.`);
  }
  if (!isFiniteNumber(b.ageMonths) || b.ageMonths < 0) {
    throw new Error('ageMonths is required and must be a non-negative number.');
  }
  if (!b.condition || !DEVICE_CONDITIONS.includes(b.condition as any)) {
    throw new Error(`condition is required and must be one of: ${DEVICE_CONDITIONS.join(', ')}.`);
  }
  if (!isFiniteNumber(b.originalPricePaise) || b.originalPricePaise < 0) {
    throw new Error('originalPricePaise is required and must be a non-negative number.');
  }

  return {
    deviceCategory: b.deviceCategory,
    ageMonths: b.ageMonths,
    condition: b.condition,
    originalPricePaise: b.originalPricePaise,
  };
}
