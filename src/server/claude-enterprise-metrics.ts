import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { dimMember, usageFacts } from "@/db/schema";
import type { DashboardFilters } from "@/lib/filters";

/**
 * Number of days a returned cost/usage row may still revise. Per Anthropic:
 * "Values for a given date may be revised for up to 30 days as late events
 * arrive and reconciliation runs. For invoicing-grade totals, query dates
 * at least 30 days in the past."
 */
export const CLAUDE_COST_REVISION_DAYS = 30;

function defaultRange(filters: DashboardFilters): { from: Date; to: Date } {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from
    ? new Date(filters.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export type ClaudeEnterpriseTotals = {
  commits: number;
  pullRequests: number;
  linesAdded: number;
  linesDeleted: number;
  sessions: number;
};

export async function getClaudeEnterpriseTotals(
  filters: DashboardFilters,
): Promise<ClaudeEnterpriseTotals> {
  const db = getDb();
  const { from, to } = defaultRange(filters);

  const [row] = await db
    .select({
      commits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'commits' then ${usageFacts.amount} else 0 end), 0)`,
      pullRequests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'pull_requests' then ${usageFacts.amount} else 0 end), 0)`,
      linesAdded: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_added' then ${usageFacts.amount} else 0 end), 0)`,
      linesDeleted: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_deleted' then ${usageFacts.amount} else 0 end), 0)`,
      sessions: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'sessions' and ${usageFacts.mode} = 'claude_code' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      ),
    );

  return {
    commits: Number(row?.commits ?? 0),
    pullRequests: Number(row?.pullRequests ?? 0),
    linesAdded: Number(row?.linesAdded ?? 0),
    linesDeleted: Number(row?.linesDeleted ?? 0),
    sessions: Number(row?.sessions ?? 0),
  };
}

export type ClaudeEnterpriseGroupRow = {
  name: string;
  value: number;
  uniqueUsers: number;
};

/**
 * Aggregates usage facts by `billing_group_name` for a specific `mode`
 * (e.g. "chat_project", "skill", "connector") on the claude_enterprise source.
 * Returns one row per group with summed metric amount and distinct users proxy
 * (sum of `distinctUsers` from dimensions_json, since each row has it).
 */
export async function getClaudeEnterpriseGroups(
  filters: DashboardFilters,
  mode: "chat_project" | "skill" | "connector",
): Promise<ClaudeEnterpriseGroupRow[]> {
  const db = getDb();
  const { from, to } = defaultRange(filters);

  const rows = await db
    .select({
      name: usageFacts.billingGroupName,
      value: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      uniqueUsers: sql<number>`coalesce(max((${usageFacts.dimensionsJson}->>'distinctUsers')::numeric), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        eq(usageFacts.mode, mode),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
        sql`${usageFacts.billingGroupName} is not null`,
      ),
    )
    .groupBy(usageFacts.billingGroupName)
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`));

  return rows
    .filter((r) => r.name)
    .map((r) => ({
      name: r.name as string,
      value: Number(r.value ?? 0),
      uniqueUsers: Number(r.uniqueUsers ?? 0),
    }));
}

/* ───────────── Spend page (cost endpoints) ───────────── */

export type ClaudeSpendKpis = {
  totalUsd: number;
  listTotalUsd: number;
  /** ISO date that the per-product bucket sync most recently wrote a fact for, or null. */
  latestBucketDate: string | null;
  invoicingGradeAsOf: string;
  topUser: { id: string | null; email: string | null; name: string | null; usd: number } | null;
  topProduct: { product: string; usd: number } | null;
  topModel: { model: string; usd: number } | null;
};

export type ClaudeSpendDailyByProduct = {
  date: string;
  byProduct: Record<string, number>;
  total: number;
};

export type ClaudeSpendUserRow = {
  memberId: string;
  email: string | null;
  name: string | null;
  totalUsd: number;
  listTotalUsd: number;
  byProduct: Record<string, number>;
};

export type ClaudeSpendModelRow = {
  model: string;
  totalUsd: number;
  listTotalUsd: number;
};

export type ClaudeSpendResponse = {
  range: { from: string; to: string };
  kpis: ClaudeSpendKpis;
  daily: ClaudeSpendDailyByProduct[];
  topUsers: ClaudeSpendUserRow[];
  topModels: ClaudeSpendModelRow[];
};

const PER_PRODUCT_BUCKET_PREFIX = "claude_enterprise:cost:bucket:product:";
const PER_MODEL_BUCKET_PREFIX = "claude_enterprise:cost:bucket:model:";
const PER_USER_COST_PREFIX = "claude_enterprise:cost:user:";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseUsdFromDimensions(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function getClaudeEnterpriseSpend(
  filters: DashboardFilters,
  options: { topUsers?: number; topModels?: number } = {},
): Promise<ClaudeSpendResponse> {
  const db = getDb();
  const { from, to } = defaultRange(filters);
  const topUsersLimit = Math.min(Math.max(options.topUsers ?? 25, 1), 200);
  const topModelsLimit = Math.min(Math.max(options.topModels ?? 25, 1), 200);

  // ---- Daily per-product totals (canonical source) ----
  const productRows = await db
    .select({
      day: sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      product: usageFacts.mode,
      amount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      listAmount: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'listAmountUsd')::numeric, 0)), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        eq(usageFacts.metricKind, "cost_usd"),
        like(usageFacts.externalId, `${PER_PRODUCT_BUCKET_PREFIX}%`),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      ),
    )
    .groupBy(sql`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, usageFacts.mode);

  const dailyMap = new Map<string, ClaudeSpendDailyByProduct>();
  let totalUsd = 0;
  let listTotalUsd = 0;
  let latestBucketDate: string | null = null;
  const productTotals = new Map<string, number>();

  for (const r of productRows) {
    const day = String(r.day);
    const product = String(r.product ?? "unknown");
    const usd = Number(r.amount ?? 0);
    const listUsd = Number(r.listAmount ?? 0);
    if (!dailyMap.has(day)) dailyMap.set(day, { date: day, byProduct: {}, total: 0 });
    const entry = dailyMap.get(day)!;
    entry.byProduct[product] = (entry.byProduct[product] ?? 0) + usd;
    entry.total += usd;
    totalUsd += usd;
    listTotalUsd += listUsd;
    productTotals.set(product, (productTotals.get(product) ?? 0) + usd);
    if (!latestBucketDate || day > latestBucketDate) latestBucketDate = day;
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  let topProduct: ClaudeSpendKpis["topProduct"] = null;
  for (const [product, usd] of productTotals) {
    if (!topProduct || usd > topProduct.usd) topProduct = { product, usd };
  }

  // ---- Top users (per-user cost rows joined to dim_member) ----
  const userRows = await db
    .select({
      memberId: dimMember.id,
      email: dimMember.email,
      name: dimMember.displayName,
      product: usageFacts.mode,
      amount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      listAmount: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'listAmountUsd')::numeric, 0)), 0)`,
    })
    .from(usageFacts)
    .innerJoin(dimMember, eq(usageFacts.memberId, dimMember.id))
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        eq(usageFacts.metricKind, "cost_usd"),
        like(usageFacts.externalId, `${PER_USER_COST_PREFIX}%`),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      ),
    )
    .groupBy(dimMember.id, dimMember.email, dimMember.displayName, usageFacts.mode);

  const userAgg = new Map<string, ClaudeSpendUserRow>();
  for (const r of userRows) {
    const id = r.memberId as string;
    const product = String(r.product ?? "unknown");
    const usd = Number(r.amount ?? 0);
    const listUsd = Number(r.listAmount ?? 0);
    if (!userAgg.has(id)) {
      userAgg.set(id, {
        memberId: id,
        email: r.email,
        name: r.name,
        totalUsd: 0,
        listTotalUsd: 0,
        byProduct: {},
      });
    }
    const entry = userAgg.get(id)!;
    entry.totalUsd += usd;
    entry.listTotalUsd += listUsd;
    entry.byProduct[product] = (entry.byProduct[product] ?? 0) + usd;
  }

  const topUsers = Array.from(userAgg.values())
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, topUsersLimit);
  const topUser = topUsers[0]
    ? { id: topUsers[0].memberId, email: topUsers[0].email, name: topUsers[0].name, usd: topUsers[0].totalUsd }
    : null;

  // ---- Top models (per-model bucket facts) ----
  const modelRows = await db
    .select({
      model: usageFacts.modelName,
      amount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      listAmount: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'listAmountUsd')::numeric, 0)), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        eq(usageFacts.metricKind, "cost_usd"),
        like(usageFacts.externalId, `${PER_MODEL_BUCKET_PREFIX}%`),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      ),
    )
    .groupBy(usageFacts.modelName);

  const topModels: ClaudeSpendModelRow[] = modelRows
    .filter((r) => r.model)
    .map((r) => ({
      model: r.model as string,
      totalUsd: Number(r.amount ?? 0),
      listTotalUsd: Number(r.listAmount ?? 0),
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, topModelsLimit);

  const topModel: ClaudeSpendKpis["topModel"] = topModels[0]
    ? { model: topModels[0].model, usd: topModels[0].totalUsd }
    : null;

  const invoicingGradeAsOf = isoDay(
    new Date(Date.now() - CLAUDE_COST_REVISION_DAYS * 24 * 60 * 60 * 1000),
  );

  return {
    range: { from: isoDay(from), to: isoDay(to) },
    kpis: {
      totalUsd,
      listTotalUsd,
      latestBucketDate,
      invoicingGradeAsOf,
      topUser,
      topProduct,
      topModel,
    },
    daily,
    topUsers,
    topModels,
  };
  void parseUsdFromDimensions; // kept for future per-row ad-hoc parsing
}

/* ───────────── Tokens page (cost endpoints) ───────────── */

export type ClaudeTokenKpis = {
  totalTokens: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheRead: number;
  totalCacheCreate: number;
  totalUncachedInput: number;
  cacheHitRate: number | null;
  webSearchRequests: number;
};

export type ClaudeTokenDailyRow = {
  date: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
};

export type ClaudeTokenUserRow = {
  memberId: string;
  email: string | null;
  name: string | null;
  totalTokens: number;
  tokensIn: number;
  tokensOut: number;
  /** USD of Prepaid Extra Usage attributed to this user from per-user cost facts. */
  extrasUsd: number;
  byProduct: Record<string, number>;
};

export type ClaudeTokenProductRow = {
  product: string;
  totalTokens: number;
  tokensIn: number;
  tokensOut: number;
};

export type ClaudeTokensResponse = {
  range: { from: string; to: string };
  kpis: ClaudeTokenKpis;
  daily: ClaudeTokenDailyRow[];
  topUsers: ClaudeTokenUserRow[];
  byProduct: ClaudeTokenProductRow[];
};

const PER_USER_TOKENS_PREFIX = "claude_enterprise:tokens:user:";

export async function getClaudeEnterpriseTokens(
  filters: DashboardFilters,
  options: { topUsers?: number } = {},
): Promise<ClaudeTokensResponse> {
  const db = getDb();
  const { from, to } = defaultRange(filters);
  const topUsersLimit = Math.min(Math.max(options.topUsers ?? 25, 1), 200);

  // All token facts come from the user_usage_report sync. The dimensionsJson
  // field carries the cache-aware breakdown so we can compute cache hit rate
  // without rehitting the API.
  const rows = await db
    .select({
      day: sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      memberId: dimMember.id,
      email: dimMember.email,
      name: dimMember.displayName,
      product: usageFacts.mode,
      kind: usageFacts.metricKind,
      amount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      cacheRead: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'cacheRead')::numeric, 0)), 0)`,
      cacheCreate5m: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'cacheCreate5m')::numeric, 0)), 0)`,
      cacheCreate1h: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'cacheCreate1h')::numeric, 0)), 0)`,
      uncached: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'uncachedInput')::numeric, 0)), 0)`,
      webSearch: sql<number>`coalesce(sum(coalesce((${usageFacts.dimensionsJson}->>'webSearchRequests')::numeric, 0)), 0)`,
    })
    .from(usageFacts)
    .innerJoin(dimMember, eq(usageFacts.memberId, dimMember.id))
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        like(usageFacts.externalId, `${PER_USER_TOKENS_PREFIX}%`),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      ),
    )
    .groupBy(
      sql`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      dimMember.id,
      dimMember.email,
      dimMember.displayName,
      usageFacts.mode,
      usageFacts.metricKind,
    );

  const dailyMap = new Map<string, ClaudeTokenDailyRow>();
  const productAgg = new Map<string, ClaudeTokenProductRow>();
  const userAgg = new Map<string, ClaudeTokenUserRow>();
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let totalUncached = 0;
  let webSearchRequests = 0;

  for (const r of rows) {
    const day = String(r.day);
    const product = String(r.product ?? "unknown");
    const memberId = r.memberId as string;
    const amount = Number(r.amount ?? 0);
    const kind = String(r.kind);

    if (!dailyMap.has(day)) {
      dailyMap.set(day, { date: day, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreate: 0 });
    }
    if (!productAgg.has(product)) {
      productAgg.set(product, { product, totalTokens: 0, tokensIn: 0, tokensOut: 0 });
    }
    if (!userAgg.has(memberId)) {
      userAgg.set(memberId, {
        memberId,
        email: r.email,
        name: r.name,
        totalTokens: 0,
        tokensIn: 0,
        tokensOut: 0,
        extrasUsd: 0,
        byProduct: {},
      });
    }
    const dailyEntry = dailyMap.get(day)!;
    const productEntry = productAgg.get(product)!;
    const userEntry = userAgg.get(memberId)!;

    if (kind === "tokens_in") {
      dailyEntry.tokensIn += amount;
      productEntry.tokensIn += amount;
      productEntry.totalTokens += amount;
      userEntry.tokensIn += amount;
      userEntry.totalTokens += amount;
      userEntry.byProduct[product] = (userEntry.byProduct[product] ?? 0) + amount;
      totalTokensIn += amount;
      // Cache breakdown is reported on every row variant via dimensionsJson;
      // count it once on the tokens_in row to avoid triple-counting.
      const cacheRead = Number(r.cacheRead ?? 0);
      const cacheCreate = Number(r.cacheCreate5m ?? 0) + Number(r.cacheCreate1h ?? 0);
      const uncached = Number(r.uncached ?? 0);
      dailyEntry.cacheRead += cacheRead;
      dailyEntry.cacheCreate += cacheCreate;
      totalCacheRead += cacheRead;
      totalCacheCreate += cacheCreate;
      totalUncached += uncached;
    } else if (kind === "tokens_out") {
      dailyEntry.tokensOut += amount;
      productEntry.tokensOut += amount;
      productEntry.totalTokens += amount;
      userEntry.tokensOut += amount;
      userEntry.totalTokens += amount;
      userEntry.byProduct[product] = (userEntry.byProduct[product] ?? 0) + amount;
      totalTokensOut += amount;
    }
    // requests rows from this prefix add to webSearch through dimensionsJson;
    // surface the count from the requests rows as authoritative web-search count.
    if (kind === "requests") {
      webSearchRequests += Number(r.webSearch ?? 0);
    }
  }

  // Layer in per-user Prepaid Extra Usage spend from the cost facts (separate
  // prefix; never double-counted with the token rows above). Users that have
  // no cost rows simply keep extrasUsd = 0.
  const PER_USER_COST_PREFIX = "claude_enterprise:cost:user:";
  const userCostRows = await db
    .select({
      memberId: dimMember.id,
      email: dimMember.email,
      name: dimMember.displayName,
      amount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .innerJoin(dimMember, eq(usageFacts.memberId, dimMember.id))
    .where(
      and(
        eq(usageFacts.sourceSystem, "claude_enterprise"),
        eq(usageFacts.metricKind, "cost_usd"),
        like(usageFacts.externalId, `${PER_USER_COST_PREFIX}%`),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      ),
    )
    .groupBy(dimMember.id, dimMember.email, dimMember.displayName);

  for (const r of userCostRows) {
    const memberId = r.memberId as string;
    const usd = Number(r.amount ?? 0);
    if (!userAgg.has(memberId)) {
      userAgg.set(memberId, {
        memberId,
        email: r.email,
        name: r.name,
        totalTokens: 0,
        tokensIn: 0,
        tokensOut: 0,
        extrasUsd: usd,
        byProduct: {},
      });
    } else {
      userAgg.get(memberId)!.extrasUsd += usd;
    }
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const byProduct = Array.from(productAgg.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  const topUsers = Array.from(userAgg.values())
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, topUsersLimit);

  // Cache hit rate = cache_read / (cache_read + uncached_input + cache_create).
  // This matches Anthropic's prompt-cache "hit" semantics: of all input tokens
  // sent, what fraction were served from the cache instead of being processed.
  const cacheDenominator = totalCacheRead + totalUncached + totalCacheCreate;
  const cacheHitRate = cacheDenominator > 0 ? totalCacheRead / cacheDenominator : null;

  return {
    range: { from: isoDay(from), to: isoDay(to) },
    kpis: {
      totalTokens: totalTokensIn + totalTokensOut,
      totalTokensIn,
      totalTokensOut,
      totalCacheRead,
      totalCacheCreate,
      totalUncachedInput: totalUncached,
      cacheHitRate,
      webSearchRequests,
    },
    daily,
    topUsers,
    byProduct,
  };
}
