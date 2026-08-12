import { DeviceCategory, DeviceCondition, ExchangeDiscountRequest, ExchangeDiscountResult } from '../types';

/**
 * Exchange Discount.
 *
 * Customer trades in an old device; we estimate its resale/scrap value using
 * a depreciation curve (category + age + condition), and apply that value as
 * an instant discount on the new purchase.
 *
 * Depreciation model: straight-line monthly decay per category, floored at a
 * category-specific residual value, then adjusted by a condition multiplier.
 * This is deliberately simple and swappable — in production this would likely
 * be a model trained on actual resale marketplace data, but the *shape* of
 * the pipeline (raw signal -> feature -> valuation) doesn't change.
 */

const MONTHLY_DEPRECIATION_PERCENT: Record<DeviceCategory, number> = {
  phone: 3.0,
  laptop: 2.0,
  tablet: 2.5,
  smartwatch: 4.0,
};

const RESIDUAL_VALUE_FLOOR_PERCENT: Record<DeviceCategory, number> = {
  phone: 5,
  laptop: 10,
  tablet: 8,
  smartwatch: 3,
};

const CONDITION_MULTIPLIER: Record<DeviceCondition, number> = {
  excellent: 1.0,
  good: 0.85,
  fair: 0.6,
  poor: 0.3,
};

export function evaluateExchangeDiscount(request: ExchangeDiscountRequest): ExchangeDiscountResult {
  const { deviceCategory, ageMonths, condition, originalPricePaise } = request;

  const monthlyRate = MONTHLY_DEPRECIATION_PERCENT[deviceCategory];
  const floorPercent = RESIDUAL_VALUE_FLOOR_PERCENT[deviceCategory];

  const rawDepreciationPercent = Math.min(100, monthlyRate * ageMonths);
  const cappedDepreciationPercent = Math.min(rawDepreciationPercent, 100 - floorPercent);

  const baseValuePaise = Math.round(originalPricePaise * (1 - cappedDepreciationPercent / 100));
  const conditionAdjustedValuePaise = Math.round(baseValuePaise * CONDITION_MULTIPLIER[condition]);

  return {
    estimatedValuePaise: conditionAdjustedValuePaise,
    discountAppliedPaise: conditionAdjustedValuePaise,
    depreciationPercentApplied: cappedDepreciationPercent,
  };
}
