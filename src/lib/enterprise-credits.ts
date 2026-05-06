/**
 * Helpers for valuing OpenAI Enterprise "credits" in USD.
 *
 * Two rates are surfaced wherever credits are displayed:
 *   - overage   = costPerOverageCreditUsd                                   (explicit pay-per-use rate)
 *   - implied   = (annualCost/12) / (freeCreditsPerSeatPerMonth*seatCount)  (contract dollars per credit)
 *
 * Both are optional; helpers gracefully omit either when the inputs are
 * missing or zero.
 */

import { formatUsd } from "@/lib/format";

export interface EnterpriseCreditRates {
  /** USD per credit when charged at the contract overage rate. */
  overageUsdPerCredit?: number;
  /** USD per credit implied by the contract: monthly $ pool / monthly credit pool. */
  impliedUsdPerCredit?: number;
}

export interface CreditUsdValuation {
  /** credits * overageUsdPerCredit */
  overageUsd?: number;
  /** credits * impliedUsdPerCredit */
  impliedUsd?: number;
}

interface RateInput {
  /** (annualCost ?? 0) / 12, in USD. */
  monthlyDollarAllocation?: number | null;
  /** freeCreditsPerSeatPerMonth * seatCount. */
  monthlyCreditAllocation?: number | null;
  /** Direct overage rate from seat config. */
  costPerOverageCreditUsd?: number | null;
}

function safePositive(n: number | null | undefined): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

export function computeEnterpriseCreditRates(input: RateInput): EnterpriseCreditRates {
  const monthlyDollars = safePositive(input.monthlyDollarAllocation);
  const monthlyCredits = safePositive(input.monthlyCreditAllocation);
  return {
    overageUsdPerCredit: safePositive(input.costPerOverageCreditUsd),
    impliedUsdPerCredit:
      monthlyDollars !== undefined && monthlyCredits !== undefined
        ? monthlyDollars / monthlyCredits
        : undefined,
  };
}

export function valuateCredits(
  credits: number | null | undefined,
  rates: EnterpriseCreditRates,
): CreditUsdValuation {
  const c = typeof credits === "number" && Number.isFinite(credits) ? credits : 0;
  return {
    overageUsd: rates.overageUsdPerCredit !== undefined ? c * rates.overageUsdPerCredit : undefined,
    impliedUsd: rates.impliedUsdPerCredit !== undefined ? c * rates.impliedUsdPerCredit : undefined,
  };
}

/** True when at least one rate is configured. */
export function hasAnyCreditRate(rates: EnterpriseCreditRates): boolean {
  return rates.overageUsdPerCredit !== undefined || rates.impliedUsdPerCredit !== undefined;
}

/**
 * Returns a single-line summary like "≈ $12.34 if charged · ~$11.20 contract value".
 * Returns null when neither rate yields a value.
 */
export function formatCreditValuation(v: CreditUsdValuation): string | null {
  const parts: string[] = [];
  if (v.overageUsd !== undefined) parts.push(`≈ ${formatUsd(v.overageUsd)} if charged`);
  if (v.impliedUsd !== undefined) parts.push(`~ ${formatUsd(v.impliedUsd)} contract value`);
  return parts.length === 0 ? null : parts.join(" · ");
}
