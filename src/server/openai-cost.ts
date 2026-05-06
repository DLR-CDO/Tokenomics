import { and, eq, gte, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { usageFacts } from "@/db/schema";
import type { DashboardFilters } from "@/lib/filters";

import {
  buildPricingLookup,
  computeListRateUsd,
  getEffectivePricing,
  getRateForModel,
  type PricingRow,
} from "./openai-pricing";

const SOURCE = "openai" as const;

function defaultRange(filters: DashboardFilters): { from: Date; to: Date } {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function baseConditions(filters: DashboardFilters) {
  const { from, to } = defaultRange(filters);
  const conds = [
    eq(usageFacts.sourceSystem, SOURCE),
    gte(usageFacts.occurredAt, from),
    lte(usageFacts.occurredAt, to),
  ];
  if (filters.model) conds.push(eq(usageFacts.modelName, filters.model));
  if (filters.billingGroup) conds.push(eq(usageFacts.billingGroupName, filters.billingGroup));
  return and(...conds);
}

interface ModelDailyTokens {
  date: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
}

interface ModelRollup {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  billedUsd: number;
}

async function fetchModelDailyTokens(filters: DashboardFilters): Promise<ModelDailyTokens[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters),
    sql`${usageFacts.metricKind} in ('tokens_in', 'tokens_out')`,
    sql`${usageFacts.modelName} is not null`,
  );
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      model: usageFacts.modelName,
      tokensIn: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then ${usageFacts.amount} else 0 end), 0)`,
      tokensOut: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' then ${usageFacts.amount} else 0 end), 0)`,
      cachedTokens: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then coalesce((${usageFacts.dimensionsJson}->>'cached_tokens')::numeric, 0) else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket, usageFacts.modelName)
    .orderBy(bucket);

  return rows
    .filter((r) => r.model)
    .map((r) => ({
      date: r.date,
      model: r.model as string,
      tokensIn: Number(r.tokensIn ?? 0),
      tokensOut: Number(r.tokensOut ?? 0),
      cachedTokens: Number(r.cachedTokens ?? 0),
    }));
}

async function fetchDailyBilled(filters: DashboardFilters): Promise<Map<string, number>> {
  const db = getDb();
  const where = and(baseConditions(filters), eq(usageFacts.metricKind, "cost_usd"));
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      cost: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.date, Number(r.cost ?? 0));
  return map;
}

async function fetchModelBilled(filters: DashboardFilters): Promise<Map<string, number>> {
  // OpenAI cost_usd rows from /v1/organization/costs do NOT carry a model name
  // (they are bucketed by line_item / project). So per-model billed USD is not
  // available from the source data — we return an empty map and surface that
  // caveat in the UI.
  void filters;
  return new Map();
}

export interface ListRateTimeseriesPoint {
  date: string;
  listRateUsd: number;
  billedUsd: number;
}

export interface ListRateByModel {
  model: string;
  listRateUsd: number;
  billedUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  hasRate: boolean;
}

export interface ListRateResult {
  data: ListRateTimeseriesPoint[];
  byModel: ListRateByModel[];
  unmappedModels: string[];
  totals: {
    listRateUsd: number;
    billedUsd: number;
    driftPct: number | null;
  };
}

async function compute(filters: DashboardFilters): Promise<ListRateResult> {
  const [daily, billedDaily, effective] = await Promise.all([
    fetchModelDailyTokens(filters),
    fetchDailyBilled(filters),
    getEffectivePricing(),
  ]);

  const lookup = buildPricingLookup(effective);
  const billedByModel = await fetchModelBilled(filters);

  const dailyAgg = new Map<string, number>();
  const modelAgg = new Map<string, ModelRollup>();
  const unmapped = new Set<string>();

  for (const r of daily) {
    const rate: PricingRow | null = getRateForModel(lookup, r.model);
    const usd = rate ? computeListRateUsd(rate, r.tokensIn, r.tokensOut, r.cachedTokens) : 0;
    if (!rate) unmapped.add(r.model);

    dailyAgg.set(r.date, (dailyAgg.get(r.date) ?? 0) + usd);

    const existing = modelAgg.get(r.model) ?? {
      model: r.model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      billedUsd: 0,
    };
    existing.tokensIn += r.tokensIn;
    existing.tokensOut += r.tokensOut;
    existing.cachedTokens += r.cachedTokens;
    modelAgg.set(r.model, existing);
  }

  const allDates = new Set<string>([...dailyAgg.keys(), ...billedDaily.keys()]);
  const sortedDates = Array.from(allDates).sort();
  const data: ListRateTimeseriesPoint[] = sortedDates.map((d) => ({
    date: d,
    listRateUsd: dailyAgg.get(d) ?? 0,
    billedUsd: billedDaily.get(d) ?? 0,
  }));

  const byModel: ListRateByModel[] = Array.from(modelAgg.values())
    .map((m) => {
      const rate = getRateForModel(lookup, m.model);
      const listRate = rate ? computeListRateUsd(rate, m.tokensIn, m.tokensOut, m.cachedTokens) : 0;
      return {
        model: m.model,
        listRateUsd: listRate,
        billedUsd: billedByModel.has(m.model) ? (billedByModel.get(m.model) ?? 0) : null,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        cachedTokens: m.cachedTokens,
        hasRate: rate !== null,
      };
    })
    .sort((a, b) => b.listRateUsd - a.listRateUsd || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));

  const totalListRate = data.reduce((s, p) => s + p.listRateUsd, 0);
  const totalBilled = data.reduce((s, p) => s + p.billedUsd, 0);
  const driftPct = totalListRate > 0 ? ((totalBilled - totalListRate) / totalListRate) * 100 : null;

  return {
    data,
    byModel,
    unmappedModels: Array.from(unmapped).sort(),
    totals: { listRateUsd: totalListRate, billedUsd: totalBilled, driftPct },
  };
}

export async function getOpenAIListRateTimeseries(filters: DashboardFilters): Promise<ListRateResult> {
  return compute(filters);
}

export async function getOpenAIListRateByModel(filters: DashboardFilters): Promise<ListRateResult> {
  return compute(filters);
}
