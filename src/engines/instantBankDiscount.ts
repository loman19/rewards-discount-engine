import { BankBinRule, InstantBankDiscountRequest, InstantBankDiscountResult } from '../types';

/**
 * Instant Bank Discount.
 *
 * Real-world shape: banks pay Amazon Pay to offer instant discounts to their
 * cardholders during promotional events. Eligibility is BIN-based (the first
 * 6 digits of the card identify the issuing bank), and each bank's deal has
 * its own discount rate, cap, and minimum cart value.
 *
 * This is intentionally a pure function: given rules + a request, return a
 * deterministic result. That makes it trivial to unit test and to later wrap
 * behind a Lambda handler or Express route without any behavior change.
 */

// Example config — in production this would be loaded from a config service /
// DynamoDB table per campaign, not hardcoded.
export const DEFAULT_BANK_RULES: BankBinRule[] = [
  {
    bankId: 'HDFC',
    binPrefixes: ['400123', '400124'],
    discountPercent: 10,
    maxDiscountPaise: 150000, // ₹1500 cap
    minCartValuePaise: 500000, // ₹5000 minimum
  },
  {
    bankId: 'ICICI',
    binPrefixes: ['411111'],
    discountPercent: 5,
    maxDiscountPaise: 100000, // ₹1000 cap
    minCartValuePaise: 200000, // ₹2000 minimum
  },
];

export function evaluateInstantBankDiscount(
  request: InstantBankDiscountRequest,
  rules: BankBinRule[] = DEFAULT_BANK_RULES
): InstantBankDiscountResult {
  const { cardBin, cartValuePaise } = request;

  const matchedRule = rules.find((rule) => rule.binPrefixes.includes(cardBin));

  if (!matchedRule) {
    return {
      eligible: false,
      discountPaise: 0,
      finalPricePaise: cartValuePaise,
      reason: 'No active bank offer for this card BIN.',
    };
  }

  if (cartValuePaise < matchedRule.minCartValuePaise) {
    return {
      eligible: false,
      bankId: matchedRule.bankId,
      discountPaise: 0,
      finalPricePaise: cartValuePaise,
      reason: `Cart value below minimum of ${matchedRule.minCartValuePaise} paise for ${matchedRule.bankId} offer.`,
    };
  }

  const rawDiscount = Math.floor((cartValuePaise * matchedRule.discountPercent) / 100);
  const discountPaise = Math.min(rawDiscount, matchedRule.maxDiscountPaise);

  return {
    eligible: true,
    bankId: matchedRule.bankId,
    discountPaise,
    finalPricePaise: cartValuePaise - discountPaise,
  };
}
