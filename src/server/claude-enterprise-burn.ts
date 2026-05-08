import { and, asc, eq, gte, like, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { dashboardSettings, usageFacts } from "@/db/schema";

/**
 * "Burn & Forecast" computation for Claude Enterprise self-serve plans.
 *
 * The Anthropic Analytics cost endpoints report consumption against the
 * Prepaid Extra Usage pool; on the self-serve Enterprise / Team plan the
 * pool is auto-reloaded by a fixed dollar amount (configured by the org)
 * whenever the balance falls below a threshold. The API does NOT surface the
 * reload events themselves — only the consumption that triggers them.
 *
 * This module turns the per-product daily cost facts into a forward-looking
 * forecast: trailing-30 burn rate, projected days to next rebill, projected
 * annual extras, and a synthetic rebill-marker series derived by stepping
 * through the cumulative curve and resetting each time it crosses the
 * configured reload amount.
 *
 * Source of truth: usage_facts rows where
 *   source_system   = 'claude_enterprise'
 *   metric_kind     = 'cost_usd'
 *   external_id     LIKE 'claude_enterprise:cost:bucket:product:%'
 * which is the canonical, deduped per-product daily bucket written by
 * syncAnalyticsCostBucketed (see src/server/claude-enterprise-sync.ts).
 */

const PER_PRODUCT_BUCKET_PREFIX = "claude_enterprise:cost:bucket:product:";
const POLICY_KEY = "claude_extra_usage_policy";
const SEAT_KEY = "seat_config_claude_enterprise";

const DEFAULT_RELOAD_USD = 300;
const TRAILING_WINDOW_DAYS = 30;
const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ClaudeExtraUsagePolicy = {
  enabled: boolean;
  thresholdUsd: number;
  reloadAmountUsd: number;
  startedOn: string | null;
  notes?: string;
};

export type CumulativePoint = { date: string; daily: number; cumulative: number };
export type RebillMarker = { date: string; cumulativeAtMarker: number; rebillNumber: number };

export type ClaudeBurnForecast = {
  policy: ClaudeExtraUsagePolicy;
  seatFeeAnnualUsd: number;
  consumedSinceStart: number;
  trailing30Burn: number;
  trailing30MonthlyEquivalent: number;
  projectedDaysToNextRebill: number | null;
  projectedRebillsPerYear: number;
  projectedAnnualExtras: number;
  projectedAnnualTotal: number;
  cumulativeSinceCycleStart: CumulativePoint[];
  rebillMarkers: RebillMarker[];
  latestDataPoint: string | null;
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIsoDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetweenInclusive(from: Date, to: Date): number {
  const diff = Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
  return Math.max(1, diff + 1);
}

export async function readExtraUsagePolicy(): Promise<ClaudeExtraUsagePolicy> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, POLICY_KEY))
    .limit(1);

  const raw = (row?.value ?? {}) as Partial<ClaudeExtraUsagePolicy>;
  const reloadAmountUsd =
    typeof raw.reloadAmountUsd === "number" && Number.isFinite(raw.reloadAmountUsd) && raw.reloadAmountUsd > 0
      ? raw.reloadAmountUsd
      : DEFAULT_RELOAD_USD;
  const thresholdUsd =
    typeof raw.thresholdUsd === "number" && Number.isFinite(raw.thresholdUsd) && raw.thresholdUsd >= 0
      ? raw.thresholdUsd
      : 0;
  const startedOn =
    typeof raw.startedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.startedOn) ? raw.startedOn : null;

  return {
    enabled: raw.enabled !== false,
    thresholdUsd,
    reloadAmountUsd,
    startedOn,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
  };
}

async function readSeatFeeAnnualUsd(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, SEAT_KEY))
    .limit(1);
  const raw = (row?.value ?? {}) as { annualCost?: number };
  return typeof raw.annualCost === "number" && Number.isFinite(raw.annualCost) && raw.annualCost > 0
    ? raw.annualCost
    : 0;
}

/**
 * Walks the daily cumulative curve and emits a marker each time the
 * running cumulative crosses an integer multiple of `reloadAmountUsd`.
 * Markers are positioned on the day the threshold is crossed; the
 * `cumulativeAtMarker` value is the cumulative-at-end-of-that-day so
 * downstream charts can place a vertical line at that x.
 */
function deriveRebillMarkers(
  cumulative: CumulativePoint[],
  reloadAmountUsd: number,
): RebillMarker[] {
  if (reloadAmountUsd <= 0 || cumulative.length === 0) return [];
  const markers: RebillMarker[] = [];
  let nextThreshold = reloadAmountUsd;
  let rebillNumber = 1;
  for (const point of cumulative) {
    while (point.cumulative >= nextThreshold) {
      markers.push({
        date: point.date,
        cumulativeAtMarker: nextThreshold,
        rebillNumber,
      });
      rebillNumber += 1;
      nextThreshold += reloadAmountUsd;
    }
  }
  return markers;
}

export async function getClaudeBurnForecast(): Promise<ClaudeBurnForecast> {
  const db = getDb();
  const policy = await readExtraUsagePolicy();
  const seatFeeAnnualUsd = await readSeatFeeAnnualUsd();

  const today = new Date();
  const todayIso = isoDay(today);
  const startOfTrailing = new Date(today.getTime() - (TRAILING_WINDOW_DAYS - 1) * MS_PER_DAY);

  // Anchor the cumulative curve to the policy startedOn (or 90 days back if
  // unset, since Anthropic only retains 90 days of analytics data anyway).
  const cycleAnchor =
    (policy.startedOn ? parseIsoDay(policy.startedOn) : null) ??
    new Date(today.getTime() - 89 * MS_PER_DAY);

  // Single SQL pass: per-day per-product cost is summed to per-day totals.
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      amount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        eq(usageFacts.metricKind, "cost_usd"),
        like(usageFacts.externalId, `${PER_PRODUCT_BUCKET_PREFIX}%`),
        gte(usageFacts.occurredAt, cycleAnchor),
        lte(usageFacts.occurredAt, today),
      ),
    )
    .groupBy(sql`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
    .orderBy(asc(sql`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`));

  let consumedSinceStart = 0;
  let trailing30Sum = 0;
  let latestDataPoint: string | null = null;
  let runningCumulative = 0;
  const cumulative: CumulativePoint[] = [];
  const trailingStartIso = isoDay(startOfTrailing);

  for (const r of dailyRows) {
    const day = String(r.day);
    const amount = Number(r.amount ?? 0);
    consumedSinceStart += amount;
    runningCumulative += amount;
    cumulative.push({ date: day, daily: amount, cumulative: runningCumulative });
    if (day >= trailingStartIso && day <= todayIso) trailing30Sum += amount;
    if (!latestDataPoint || day > latestDataPoint) latestDataPoint = day;
  }

  const trailing30Burn = trailing30Sum / TRAILING_WINDOW_DAYS;
  const trailing30MonthlyEquivalent = trailing30Burn * 30;

  const projectedDaysToNextRebill =
    trailing30Burn > 0 && policy.reloadAmountUsd > 0
      ? policy.reloadAmountUsd / trailing30Burn
      : null;
  const projectedAnnualExtras = trailing30Burn * DAYS_PER_YEAR;
  const projectedRebillsPerYear =
    policy.reloadAmountUsd > 0 ? projectedAnnualExtras / policy.reloadAmountUsd : 0;
  const projectedAnnualTotal = seatFeeAnnualUsd + projectedAnnualExtras;

  const rebillMarkers = deriveRebillMarkers(cumulative, policy.reloadAmountUsd);

  // Reference: rangeDays kept available for callers that may want it.
  void daysBetweenInclusive;

  return {
    policy,
    seatFeeAnnualUsd,
    consumedSinceStart,
    trailing30Burn,
    trailing30MonthlyEquivalent,
    projectedDaysToNextRebill,
    projectedRebillsPerYear,
    projectedAnnualExtras,
    projectedAnnualTotal,
    cumulativeSinceCycleStart: cumulative,
    rebillMarkers,
    latestDataPoint,
  };
}
