import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { billingCycles, dashboardSettings } from "@/db/schema";
import type { DashboardFilters, SourceSystem } from "@/lib/filters";
import { computeEnterpriseCreditRates, hasAnyCreditRate, valuateCredits } from "@/lib/enterprise-credits";
import {
  purchasesInRange,
  readSupplementalPurchases,
  sumPurchasesInRange,
  type SupplementalPurchase,
} from "@/lib/supplemental-purchases";
import { getBillingWindowAtOffset } from "@/server/billing-window";
import { getOpenAIListRateTimeseries } from "@/server/openai-cost";
import { getSummary, getTimeseries, type TimeseriesRow } from "@/server/metrics";

type ExecutiveSource = SourceSystem;

export type ExecutiveStatus =
  | "credit-covered"
  | "healthy"
  | "funding-watch"
  | "projected-over"
  | "estimated"
  | "incomplete";

export type ExecutiveAppCard = {
  source: ExecutiveSource;
  label: string;
  href: string;
  periodLabel?: string;
  primaryUsd: number;
  primaryLabel: string;
  usageLabel: string;
  usageValue: number;
  tokens: number;
  requests: number;
  costPerMillionTokens: number | null;
  previousPrimaryUsd: number;
  changePct: number | null;
  projectedUsd: number;
  status: ExecutiveStatus;
  statusLabel: string;
  recommendation: string;
  warnings: string[];
  trend: { date: string; usd: number }[];
};

export type GlobalExecutiveMetrics = {
  data: ExecutiveAppCard[];
};

type AppConfig = {
  source: ExecutiveSource;
  label: string;
  href: string;
};

type SeatConfig = {
  annualCost?: number;
  seatCount?: number;
  billingResetDay?: number;
  freeCreditsPerSeatPerMonth?: number;
  costPerOverageCreditUsd?: number;
};

type Range = {
  from: Date;
  to: Date;
};

type GlobalExecutiveOptions = {
  useSourceCycles?: boolean;
  cycleOffset?: number;
};

const APPS: AppConfig[] = [
  { source: "cursor", label: "Cursor", href: "/cursor/overview" },
  { source: "openai_enterprise", label: "OpenAI Enterprise", href: "/openai-enterprise/overview" },
  { source: "openai", label: "OpenAI API", href: "/openai-api/overview" },
  { source: "claude_enterprise", label: "Claude Enterprise", href: "/claude-enterprise/overview" },
  { source: "azure", label: "Azure", href: "/azure/overview" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_THRESHOLD = 70;

function resolveRange(filters: DashboardFilters): Range {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 29 * DAY_MS);
  return { from, to };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeDays(range: Range): number {
  return Math.max(1, Math.round((startOfUtcDay(range.to).getTime() - startOfUtcDay(range.from).getTime()) / DAY_MS) + 1);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function filtersForRange(filters: DashboardFilters, range: Range): DashboardFilters {
  return {
    ...filters,
    from: dateOnly(range.from),
    to: dateOnly(range.to),
  };
}

function previousRange(range: Range): Range {
  const days = rangeDays(range);
  const to = new Date(startOfUtcDay(range.from).getTime() - DAY_MS);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  return { from, to };
}

function rangeLabel(range: Range): string {
  return `${dateOnly(range.from)} to ${dateOnly(range.to)}`;
}

function changePct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function costPerMillionTokens(usd: number, tokens: number): number | null {
  if (tokens <= 0 || usd <= 0) return null;
  return usd / (tokens / 1_000_000);
}

function sumCredits(rows: TimeseriesRow[]): number {
  return rows.reduce((sum, row) => sum + row.credits, 0);
}

function sumCost(rows: TimeseriesRow[]): number {
  return rows.reduce((sum, row) => sum + row.costUsd, 0);
}

function trendFromRows(rows: TimeseriesRow[], usdForRow: (row: TimeseriesRow) => number): { date: string; usd: number }[] {
  return rows.map((row) => ({ date: row.date, usd: usdForRow(row) }));
}

function datesInRange(range: Range): string[] {
  const dates: string[] = [];
  const start = startOfUtcDay(range.from).getTime();
  const end = startOfUtcDay(range.to).getTime();
  for (let time = start; time <= end; time += DAY_MS) {
    dates.push(dateOnly(new Date(time)));
  }
  return dates;
}

function fillTrendRange(trend: { date: string; usd: number }[], range: Range): { date: string; usd: number }[] {
  const byDate = new Map(trend.map((point) => [point.date, point.usd]));
  return datesInRange(range).map((date) => ({ date, usd: byDate.get(date) ?? 0 }));
}

function usageScore(summary: Awaited<ReturnType<typeof getSummary>>, credits: number): number {
  return summary.windowSpendUsd + summary.tokens + summary.requests + credits + summary.activeUsers;
}

/** Default trailing window for projection burn-rate (days). */
const TRAILING_WINDOW_DAYS = 30;

/**
 * Compute the average daily value over the most recent `windowDays` of
 * realised history. Days strictly after `now` are excluded so future-padded
 * series (e.g. Claude's flat seat fill) don't dilute the rate.
 */
function trailingDailyRate(
  daily: { date: string; value: number }[],
  windowDays = TRAILING_WINDOW_DAYS,
  now = new Date(),
): number {
  if (daily.length === 0) return 0;
  const todayIso = startOfUtcDay(now).toISOString().slice(0, 10);
  const historical = [...daily]
    .filter((d) => d.date <= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (historical.length === 0) return 0;
  const tail = historical.slice(-Math.max(1, Math.min(windowDays, historical.length)));
  const sum = tail.reduce((s, d) => s + d.value, 0);
  return sum / tail.length;
}

/**
 * Growth-aware projection: realised spend so far + (trailing daily rate ×
 * remaining calendar days in the window). Falls back to the realised total
 * when the window is entirely in the past.
 *
 * This replaces the YTD-average extrapolation for variable-spend apps so the
 * Overview/Forecast properly reflect recent pace changes (e.g. usage that has
 * 3×'d since January won't be averaged-down by the slow start of the year).
 */
function projectWithTrailingRate(
  realisedTotal: number,
  daily: { date: string; value: number }[],
  range: Range,
  windowDays = TRAILING_WINDOW_DAYS,
  now = new Date(),
): number {
  const totalDays = rangeDays(range);
  const today = startOfUtcDay(now).getTime();
  const from = startOfUtcDay(range.from).getTime();
  const to = startOfUtcDay(range.to).getTime();

  if (to < today) return realisedTotal;
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.floor((Math.min(today, to) - from) / DAY_MS) + 1));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  if (remainingDays === 0) return realisedTotal;

  const trailingRate = trailingDailyRate(daily, windowDays, now);
  return realisedTotal + trailingRate * remainingDays;
}

async function readSeatConfig(source: ExecutiveSource): Promise<SeatConfig | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, `seat_config_${source}`))
    .limit(1);
  return (row?.value as SeatConfig | undefined) ?? null;
}

async function resolveSourceCycleRange(source: ExecutiveSource, offset = 0): Promise<Range | null> {
  const db = getDb();
  const safeOffset = Math.min(0, Math.trunc(offset));

  if (source === "cursor") {
    // billing_cycles is the source of truth for cursor; step back by |offset| rows.
    const rows = await db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.sourceSystem, "cursor"))
      .orderBy(desc(billingCycles.cycleStart))
      .limit(1)
      .offset(Math.abs(safeOffset));
    const cycle = rows[0];
    if (cycle) {
      return { from: new Date(cycle.cycleStart), to: new Date(cycle.cycleEnd) };
    }
  }

  const billingSource: ExecutiveSource =
    source === "openai" ? "openai_enterprise" : source;
  const config = await readSeatConfig(billingSource);
  if (!config?.billingResetDay) return null;
  const cycle = getBillingWindowAtOffset(config.billingResetDay, new Date(), safeOffset);
  return { from: cycle.start, to: cycle.end };
}

function baseRecommendation(label: string, change: number | null, projectedUsd: number, primaryUsd: number): string {
  const trend = change === null ? "new usage" : change > 10 ? "rising usage" : change < -10 ? "declining usage" : "stable usage";
  if (projectedUsd > primaryUsd * 1.15) {
    return `${label} is pacing above the current period total; include it in the funding discussion and watch the run rate.`;
  }
  if (trend === "rising usage") {
    return `${label} usage is growing; keep it visible in funding conversations while the trend is still forming.`;
  }
  if (trend === "declining usage") {
    return `${label} usage is easing versus the prior period; no immediate funding action is indicated.`;
  }
  if (trend === "new usage") {
    return `${label} has current-period usage without a prior-period baseline; treat this as a new funding signal.`;
  }
  return `${label} spend is stable for the selected period; continue monitoring through the app drilldown.`;
}

async function buildOpenAICard(
  app: AppConfig,
  filters: DashboardFilters,
  prevFilters: DashboardFilters,
  range: Range,
  periodLabel?: string,
): Promise<ExecutiveAppCard | null> {
  const [summary, currentCost, previousCost] = await Promise.all([
    getSummary(filters, app.source),
    getOpenAIListRateTimeseries(filters),
    getOpenAIListRateTimeseries(prevFilters),
  ]);

  const currentUsd = currentCost.totals.billedUsd > 0 ? currentCost.totals.billedUsd : currentCost.totals.listRateUsd;
  const previousUsd = previousCost.totals.billedUsd > 0 ? previousCost.totals.billedUsd : previousCost.totals.listRateUsd;
  if (usageScore(summary, 0) <= 0 && currentUsd <= 0) return null;

  const warnings: string[] = [];
  if (currentCost.totals.billedUsd <= 0 && currentCost.totals.listRateUsd > 0) {
    warnings.push("Using list-rate estimate because billed OpenAI API cost is unavailable.");
  }
  if (currentCost.unmappedModels.length > 0) {
    warnings.push(`${currentCost.unmappedModels.length} model${currentCost.unmappedModels.length === 1 ? "" : "s"} missing pricing.`);
  }

  const useBilled = currentCost.totals.billedUsd > 0;
  const dailyUsd = currentCost.data.map((p) => ({
    date: p.date,
    value: useBilled ? p.billedUsd : p.listRateUsd,
  }));
  const projectedUsd = projectWithTrailingRate(currentUsd, dailyUsd, range);
  const change = changePct(currentUsd, previousUsd);
  const status: ExecutiveStatus = warnings.length > 0 ? "estimated" : "healthy";

  return {
    source: app.source,
    label: app.label,
    href: app.href,
    periodLabel,
    primaryUsd: currentUsd,
    primaryLabel: currentCost.totals.billedUsd > 0 ? "Estimated spend" : "List-rate value",
    usageLabel: "Tokens",
    usageValue: summary.tokens,
    tokens: summary.tokens,
    requests: summary.requests,
    costPerMillionTokens: costPerMillionTokens(currentUsd, summary.tokens),
    previousPrimaryUsd: previousUsd,
    changePct: change,
    projectedUsd,
    status,
    statusLabel: status === "estimated" ? "Estimated Pricing" : "Healthy",
    recommendation: baseRecommendation(app.label, change, projectedUsd, currentUsd),
    warnings,
    trend: fillTrendRange(
      currentCost.data.map((point) => ({
        date: point.date,
        usd: currentCost.totals.billedUsd > 0 ? point.billedUsd : point.listRateUsd,
      })),
      range,
    ),
  };
}

async function buildEnterpriseCard(
  app: AppConfig,
  filters: DashboardFilters,
  prevFilters: DashboardFilters,
  range: Range,
  periodLabel?: string,
): Promise<ExecutiveAppCard | null> {
  const [summary, previousSummary, timeseries, previousTimeseries, seatConfig] = await Promise.all([
    getSummary(filters, app.source),
    getSummary(prevFilters, app.source),
    getTimeseries(filters, app.source),
    getTimeseries(prevFilters, app.source),
    readSeatConfig(app.source),
  ]);

  const credits = sumCredits(timeseries);
  const previousCredits = sumCredits(previousTimeseries);
  if (usageScore(summary, credits) <= 0) return null;

  const monthlyCreditAllocation =
    (seatConfig?.freeCreditsPerSeatPerMonth ?? 0) > 0 && (seatConfig?.seatCount ?? 0) > 0
      ? (seatConfig?.freeCreditsPerSeatPerMonth ?? 0) * (seatConfig?.seatCount ?? 0)
      : 0;
  const monthlyDollarAllocation = (seatConfig?.annualCost ?? 0) > 0 ? (seatConfig?.annualCost ?? 0) / 12 : 0;
  const rates = computeEnterpriseCreditRates({
    monthlyDollarAllocation,
    monthlyCreditAllocation,
    costPerOverageCreditUsd: seatConfig?.costPerOverageCreditUsd,
  });
  const hasRates = hasAnyCreditRate(rates);
  const rate = rates.overageUsdPerCredit ?? rates.impliedUsdPerCredit ?? 0;
  const valuedCredits = valuateCredits(credits, rates);
  const previousValuedCredits = valuateCredits(previousCredits, rates);
  const currentUsd = valuedCredits.overageUsd ?? valuedCredits.impliedUsd ?? summary.windowSpendUsd;
  const previousUsd = previousValuedCredits.overageUsd ?? previousValuedCredits.impliedUsd ?? previousSummary.windowSpendUsd;
  const dailyCredits = timeseries.map((r) => ({ date: r.date, value: r.credits }));
  const dailyEnterpriseUsd = timeseries.map((r) => ({ date: r.date, value: r.costUsd }));
  const projectedCredits = projectWithTrailingRate(credits, dailyCredits, range);
  const projectedUsd = hasRates ? projectedCredits * rate : projectWithTrailingRate(currentUsd, dailyEnterpriseUsd, range);
  const creditPercentUsed = monthlyCreditAllocation > 0 ? (credits / monthlyCreditAllocation) * 100 : null;
  const projectedCreditPercentUsed = monthlyCreditAllocation > 0 ? (projectedCredits / monthlyCreditAllocation) * 100 : null;

  const warnings: string[] = [];
  if (!hasRates) warnings.push("Enterprise credit valuation is incomplete; configure credit rates for dollar value.");
  if (monthlyCreditAllocation <= 0) warnings.push("Enterprise credit allocation is not configured.");

  let status: ExecutiveStatus = "credit-covered";
  let statusLabel = "Credit Covered";
  if (warnings.length > 0) {
    status = "incomplete";
    statusLabel = "Incomplete Data";
  } else if ((projectedCreditPercentUsed ?? 0) > 100 || (creditPercentUsed ?? 0) > 100) {
    status = "projected-over";
    statusLabel = "Projected Over";
  } else if ((projectedCreditPercentUsed ?? 0) >= WARNING_THRESHOLD || (creditPercentUsed ?? 0) >= WARNING_THRESHOLD) {
    status = "funding-watch";
    statusLabel = "Funding Watch";
  }

  const change = changePct(currentUsd, previousUsd);
  const recommendation =
    status === "credit-covered"
      ? "OpenAI Enterprise usage is credit-covered; use the consumed value to show funding partners the demand already being absorbed."
      : status === "funding-watch"
        ? "OpenAI Enterprise is approaching the credit threshold; prepare the funding case before usage crosses the covered zone."
        : status === "projected-over"
          ? "OpenAI Enterprise is projected beyond the covered credit zone; leadership should plan for overage or additional allocation."
          : "OpenAI Enterprise has usage, but credit valuation or allocation settings are incomplete; confirm the finance inputs before presenting.";

  return {
    source: app.source,
    label: app.label,
    href: app.href,
    periodLabel,
    primaryUsd: currentUsd,
    primaryLabel: "Credit-covered value",
    usageLabel: "Credits",
    usageValue: credits,
    tokens: summary.tokens,
    requests: summary.requests,
    costPerMillionTokens: costPerMillionTokens(currentUsd, summary.tokens),
    previousPrimaryUsd: previousUsd,
    changePct: change,
    projectedUsd,
    status,
    statusLabel,
    recommendation,
    warnings,
    trend: fillTrendRange(trendFromRows(timeseries, (row) => (hasRates ? row.credits * rate : row.costUsd)), range),
  };
}

async function buildClaudeEnterpriseCard(
  app: AppConfig,
  filters: DashboardFilters,
  prevFilters: DashboardFilters,
  range: Range,
  periodLabel?: string,
): Promise<ExecutiveAppCard | null> {
  const [summary, previousSummary, timeseries, seatConfig, supplementals] = await Promise.all([
    getSummary(filters, app.source),
    getSummary(prevFilters, app.source),
    getTimeseries(filters, app.source),
    readSeatConfig(app.source),
    readSupplementalPurchases(app.source),
  ]);

  if (
    usageScore(summary, 0) <= 0 &&
    !(seatConfig?.annualCost && seatConfig.annualCost > 0) &&
    supplementals.length === 0
  ) {
    return null;
  }

  const monthlyValue = (seatConfig?.annualCost ?? 0) > 0 ? (seatConfig?.annualCost ?? 0) / 12 : 0;
  // For seat-covered products, the "primary" dollar value is the prorated seat spend over the window
  // PLUS any supplemental top-up purchases (e.g. mid-cycle credit additions) recorded for this source.
  const totalDays = rangeDays(range);
  const daysInMonth = 30;
  const proratedSeatUsd = monthlyValue > 0 ? (monthlyValue * totalDays) / daysInMonth : 0;
  const supplementalsInRange = sumPurchasesInRange(supplementals, range.from, range.to);
  const currentUsd = proratedSeatUsd + supplementalsInRange;

  // Prior period also gets prorated seat + any supplementals dated in that window.
  const prevRange = previousRange(range);
  const prevProratedSeatUsd = monthlyValue > 0 ? (monthlyValue * rangeDays(prevRange)) / daysInMonth : 0;
  const prevSupplementalsInRange = sumPurchasesInRange(supplementals, prevRange.from, prevRange.to);
  const previousUsd = prevProratedSeatUsd + prevSupplementalsInRange;

  const warnings: string[] = [];
  if (monthlyValue <= 0 && supplementals.length === 0) {
    warnings.push("Claude Enterprise seat contract is not configured.");
  }

  // Supplemental purchases ARE realised spend, so they're already in the primary
  // total above; the projected value is the same (no further extrapolation).
  const projectedUsd = currentUsd;
  const change = changePct(currentUsd, previousUsd);
  const status: ExecutiveStatus =
    warnings.length > 0
      ? "incomplete"
      : supplementalsInRange > 0
        ? "funding-watch"
        : "credit-covered";
  const statusLabel =
    warnings.length > 0
      ? "Incomplete Data"
      : supplementalsInRange > 0
        ? "Top-Up Required"
        : "Covered by Contract";

  // Trend: distribute prorated seat across each calendar day in the window, plus
  // a one-day spike on each supplemental purchase date that falls in range.
  const dailySeat = totalDays > 0 ? proratedSeatUsd / totalDays : 0;
  const seatTrend = trendFromRows(timeseries, () => dailySeat);
  const supplementalsForRange = purchasesInRange(supplementals, range.from, range.to);
  const supplementalsByDate = new Map<string, number>();
  for (const p of supplementalsForRange) {
    supplementalsByDate.set(p.date, (supplementalsByDate.get(p.date) ?? 0) + p.amountUsd);
  }
  const filledSeatTrend = fillTrendRange(seatTrend, range);
  const trend = filledSeatTrend.map((point) => ({
    date: point.date,
    usd: point.usd + (supplementalsByDate.get(point.date) ?? 0),
  }));

  const recommendation =
    warnings.length > 0
      ? "Claude Enterprise has usage but the contract seat value is not configured; set it in Settings → Claude Enterprise."
      : supplementalsInRange > 0
        ? `Claude Enterprise required ${supplementalsForRange.length} supplemental top-up${supplementalsForRange.length === 1 ? "" : "s"} totalling ${supplementalsInRange.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} this period; factor that into the next contract conversation.`
        : "Claude Enterprise usage is covered by the flat seat contract; highlight absorbed demand in funding conversations.";

  return {
    source: app.source,
    label: app.label,
    href: app.href,
    periodLabel,
    primaryUsd: currentUsd,
    primaryLabel: supplementalsInRange > 0 ? "Contract + top-ups" : "Contract-covered value",
    usageLabel: summary.requests > 0 ? "Messages" : "Tokens",
    usageValue: summary.requests > 0 ? summary.requests : summary.tokens,
    tokens: summary.tokens,
    requests: summary.requests,
    costPerMillionTokens: costPerMillionTokens(currentUsd, summary.tokens),
    previousPrimaryUsd: previousUsd,
    changePct: change,
    projectedUsd,
    status,
    statusLabel,
    recommendation,
    warnings,
    trend,
  };
  void previousSummary; // keep prev fetch for symmetry / future diffs
}

async function buildStandardCard(
  app: AppConfig,
  filters: DashboardFilters,
  prevFilters: DashboardFilters,
  range: Range,
  periodLabel?: string,
): Promise<ExecutiveAppCard | null> {
  const [summary, previousSummary, timeseries] = await Promise.all([
    getSummary(filters, app.source),
    getSummary(prevFilters, app.source),
    getTimeseries(filters, app.source),
  ]);

  const credits = sumCredits(timeseries);
  const currentUsd = sumCost(timeseries);
  const previousUsd = previousSummary.windowSpendUsd;
  if (usageScore(summary, credits) <= 0 && currentUsd <= 0) return null;

  const warnings: string[] = [];
  if (currentUsd <= 0 && (summary.tokens > 0 || summary.requests > 0)) {
    warnings.push("Usage exists without estimated spend; pricing import may be incomplete.");
  }

  const dailyUsd = timeseries.map((r) => ({ date: r.date, value: r.costUsd }));
  const projectedUsd = projectWithTrailingRate(currentUsd, dailyUsd, range);
  const change = changePct(currentUsd, previousUsd);
  const status: ExecutiveStatus = warnings.length > 0 ? "incomplete" : projectedUsd > currentUsd * 1.25 ? "funding-watch" : "healthy";

  return {
    source: app.source,
    label: app.label,
    href: app.href,
    periodLabel,
    primaryUsd: currentUsd,
    primaryLabel: "Estimated spend",
    usageLabel: summary.tokens > 0 ? "Tokens" : "Requests",
    usageValue: summary.tokens > 0 ? summary.tokens : summary.requests,
    tokens: summary.tokens,
    requests: summary.requests,
    costPerMillionTokens: costPerMillionTokens(currentUsd, summary.tokens),
    previousPrimaryUsd: previousUsd,
    changePct: change,
    projectedUsd,
    status,
    statusLabel: status === "healthy" ? "Healthy" : status === "funding-watch" ? "Funding Watch" : "Incomplete Data",
    recommendation: baseRecommendation(app.label, change, projectedUsd, currentUsd),
    warnings,
    trend: fillTrendRange(trendFromRows(timeseries, (row) => row.costUsd), range),
  };
}

async function buildCard(app: AppConfig, filters: DashboardFilters, options: GlobalExecutiveOptions): Promise<ExecutiveAppCard | null> {
  const fallbackRange = resolveRange(filters);
  const range = options.useSourceCycles
    ? (await resolveSourceCycleRange(app.source, options.cycleOffset ?? 0)) ?? fallbackRange
    : fallbackRange;
  const periodLabel = options.useSourceCycles ? rangeLabel(range) : undefined;
  const currentFilters = filtersForRange(filters, range);
  const prevFilters = filtersForRange(filters, previousRange(range));

  if (app.source === "openai") return buildOpenAICard(app, currentFilters, prevFilters, range, periodLabel);
  if (app.source === "openai_enterprise") return buildEnterpriseCard(app, currentFilters, prevFilters, range, periodLabel);
  if (app.source === "claude_enterprise")
    return buildClaudeEnterpriseCard(app, currentFilters, prevFilters, range, periodLabel);
  return buildStandardCard(app, currentFilters, prevFilters, range, periodLabel);
}

export async function getGlobalExecutiveMetrics(
  filters: DashboardFilters,
  options: GlobalExecutiveOptions = {},
): Promise<GlobalExecutiveMetrics> {
  const cards = await Promise.all(APPS.map((app) => buildCard(app, filters, options)));
  return { data: cards.filter((card): card is ExecutiveAppCard => card !== null) };
}

/**
 * Combined daily USD spend across all five apps using each app's preferred
 * valuator — mirrors the methodology used by getGlobalExecutiveMetrics so that
 * downstream forecasts (e.g. /api/metrics/forecast?source=global) reconcile
 * with the Global Overview totals instead of only counting raw cost_usd rows.
 *
 * Per-app valuation:
 *   - cursor / azure         → usage_facts.cost_usd (per day)
 *   - openai (API)           → billedUsd if any, otherwise list-rate USD
 *   - openai_enterprise      → credits × overage rate (or implied rate)
 *                              falls back to cost_usd when no rates configured
 *   - claude_enterprise      → flat seat contract prorated to monthlyValue/30
 *                              filled across every historical day in the window
 *
 * Future days are excluded so the forecaster sees only realised spend.
 */
export async function getGlobalDailyUsdTimeseries(
  filters: DashboardFilters,
): Promise<{ date: string; value: number }[]> {
  const range = resolveRange(filters);
  const today = startOfUtcDay(new Date());
  const historicalEndMs = Math.min(today.getTime(), startOfUtcDay(range.to).getTime());
  const historicalRange: Range = {
    from: range.from,
    to: new Date(historicalEndMs),
  };
  const historicalDates =
    historicalEndMs >= startOfUtcDay(range.from).getTime() ? datesInRange(historicalRange) : [];

  const sumByDate = new Map<string, number>();
  for (const d of historicalDates) sumByDate.set(d, 0);

  const addPoint = (date: string, usd: number) => {
    if (!Number.isFinite(usd) || usd === 0) return;
    sumByDate.set(date, (sumByDate.get(date) ?? 0) + usd);
  };

  const [
    cursorTs,
    azureTs,
    openaiCost,
    enterpriseTs,
    enterpriseSeats,
    claudeSeats,
    claudeSupplementals,
  ] = await Promise.all([
    getTimeseries(filters, "cursor"),
    getTimeseries(filters, "azure"),
    getOpenAIListRateTimeseries(filters),
    getTimeseries(filters, "openai_enterprise"),
    readSeatConfig("openai_enterprise"),
    readSeatConfig("claude_enterprise"),
    readSupplementalPurchases("claude_enterprise"),
  ]);

  for (const r of cursorTs) addPoint(r.date, r.costUsd);
  for (const r of azureTs) addPoint(r.date, r.costUsd);

  const openaiUseBilled = openaiCost.totals.billedUsd > 0;
  for (const p of openaiCost.data) {
    addPoint(p.date, openaiUseBilled ? p.billedUsd : p.listRateUsd);
  }

  const monthlyCreditAllocation =
    (enterpriseSeats?.freeCreditsPerSeatPerMonth ?? 0) > 0 && (enterpriseSeats?.seatCount ?? 0) > 0
      ? (enterpriseSeats?.freeCreditsPerSeatPerMonth ?? 0) * (enterpriseSeats?.seatCount ?? 0)
      : 0;
  const monthlyDollarAllocation = (enterpriseSeats?.annualCost ?? 0) > 0 ? (enterpriseSeats?.annualCost ?? 0) / 12 : 0;
  const enterpriseRates = computeEnterpriseCreditRates({
    monthlyDollarAllocation,
    monthlyCreditAllocation,
    costPerOverageCreditUsd: enterpriseSeats?.costPerOverageCreditUsd,
  });
  const enterpriseHasRates = hasAnyCreditRate(enterpriseRates);
  const enterpriseRate = enterpriseRates.overageUsdPerCredit ?? enterpriseRates.impliedUsdPerCredit ?? 0;
  for (const r of enterpriseTs) {
    const usd = enterpriseHasRates ? r.credits * enterpriseRate : r.costUsd;
    addPoint(r.date, usd);
  }

  // Claude Enterprise: flat seat contract prorated across HISTORICAL days only.
  // We deliberately do NOT fill future-dated days here — doing so would pollute
  // forecastFromDaily's input (it treats every point as realised history) and
  // the projection tail would collapse to Claude's $14/day flat rate. The full
  // contract value is still captured in getGlobalForecastSummary via Overview's
  // per-app card, which is what the recommendation/headline number uses.
  const claudeMonthlyValue = (claudeSeats?.annualCost ?? 0) > 0 ? (claudeSeats?.annualCost ?? 0) / 12 : 0;
  if (claudeMonthlyValue > 0) {
    const dailyClaude = claudeMonthlyValue / 30;
    for (const d of historicalDates) addPoint(d, dailyClaude);
  }

  // Claude Enterprise: supplemental top-up purchases land as point-in-time
  // additions on their purchase date (only those that have already happened).
  const historicalEnd = new Date(historicalEndMs);
  for (const p of purchasesInRange(claudeSupplementals, range.from, historicalEnd)) {
    addPoint(p.date, p.amountUsd);
  }

  return Array.from(sumByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/**
 * Per-app primary + projected USD totals for the Global view, derived from the
 * same card-builders used by the Overview. Used by the Forecast tab so its
 * headline number reconciles with the Overview's projected total instead of
 * silently undercounting credit-valued or contract-flat apps.
 */
export type GlobalForecastSummary = {
  ytdSpend: number;
  projectedTotal: number;
  perApp: { source: ExecutiveSource; label: string; primaryUsd: number; projectedUsd: number }[];
};

export async function getGlobalForecastSummary(filters: DashboardFilters): Promise<GlobalForecastSummary> {
  const { data } = await getGlobalExecutiveMetrics(filters);
  const perApp = data.map((c) => ({
    source: c.source,
    label: c.label,
    primaryUsd: c.primaryUsd,
    projectedUsd: c.projectedUsd,
  }));
  const ytdSpend = perApp.reduce((s, c) => s + c.primaryUsd, 0);
  const projectedTotal = perApp.reduce((s, c) => s + c.projectedUsd, 0);
  return { ytdSpend, projectedTotal, perApp };
}
