import { and, desc, eq, gte, lte, sql, sum } from "drizzle-orm";

import { getDb } from "@/db";
import { billingCycles, connectorRuns, dimMember, usageFacts } from "@/db/schema";
import type { DashboardFilters } from "@/lib/filters";

function defaultRange(filters: DashboardFilters): { from: Date; to: Date } {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

function baseConditions(filters: DashboardFilters, source: string) {
  const { from, to } = defaultRange(filters);
  const conds = [
    gte(usageFacts.occurredAt, from),
    lte(usageFacts.occurredAt, to),
  ];
  if (source !== "global") {
    conds.push(eq(usageFacts.sourceSystem, source as any));
  }
  if (filters.model) {
    conds.push(eq(usageFacts.modelName, filters.model));
  }
  if (filters.memberId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.memberId)) {
    conds.push(eq(usageFacts.memberId, filters.memberId));
  }
  if (filters.billingGroup) {
    conds.push(eq(usageFacts.billingGroupName, filters.billingGroup));
  }
  return and(...conds);
}

export async function getSummary(filters: DashboardFilters, source: string) {
  const db = getDb();
  const where = baseConditions(filters, source);
  const isCursor = source === "cursor";

  const [row] = await db
    .select({
      tokens: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} in ('tokens_in','tokens_out') then ${usageFacts.amount} else 0 end), 0)`,
      requests: source === "claude_enterprise"
        ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' and ${usageFacts.externalId} not like 'claude_enterprise:cost_endpoint:%' then ${usageFacts.amount} else 0 end), 0)`
        : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
      cycleSpendUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.externalId} like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : sql<number>`0`,
      windowSpendUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} not like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : source === "claude_enterprise"
          // See getTimeseries: count only the per-product bucket facts so we
          // don't double/triple-count the per-user / per-model cost facts.
          ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} like 'claude_enterprise:cost:bucket:product:%' then ${usageFacts.amount} else 0 end), 0)`
          : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' then ${usageFacts.amount} else 0 end), 0)`,
      linesAdded: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_added' then ${usageFacts.amount} else 0 end), 0)`,
      agentEditsAccepted: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'agent_edits_accepted' then ${usageFacts.amount} else 0 end), 0)`,
      avgDau: sql<number>`coalesce(avg(case when ${usageFacts.metricKind} = 'dau' then ${usageFacts.amount} end), 0)`,
      activeUsers: sql<number>`count(distinct ${usageFacts.memberId})::int`,
    })
    .from(usageFacts)
    .where(where);

  const [members] = await db
    .select({ c: sql<number>`count(distinct ${dimMember.email})::int` })
    .from(dimMember)
    .where(source === "global" ? undefined : eq(dimMember.sourceSystem, source as any));

  const [lastSync] = await db
    .select({ finishedAt: connectorRuns.finishedAt, status: connectorRuns.status })
    .from(connectorRuns)
    .where(source === "global" ? undefined : eq(connectorRuns.sourceSystem, source as any))
    .orderBy(desc(connectorRuns.finishedAt))
    .limit(1);

  return {
    tokens: row?.tokens ?? 0,
    requests: row?.requests ?? 0,
    cycleSpendUsd: row?.cycleSpendUsd ?? 0,
    windowSpendUsd: row?.windowSpendUsd ?? 0,
    linesAdded: row?.linesAdded ?? 0,
    agentEditsAccepted: row?.agentEditsAccepted ?? 0,
    avgDau: row?.avgDau ?? 0,
    activeUsers: Number(row?.activeUsers ?? 0),
    memberCount: Number(members?.c ?? 0),
    lastSyncedAt: lastSync?.finishedAt?.toISOString() ?? null,
    lastSyncStatus: lastSync?.status ?? null,
  };
}

export type TimeseriesRow = {
  date: string;
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  requests: number;
  costUsd: number;
  dau: number;
  linesAdded: number;
  credits: number;
};

export async function getTimeseries(filters: DashboardFilters, source: string): Promise<TimeseriesRow[]> {
  const db = getDb();
  const where = baseConditions(filters, source);
  const isCursor = source === "cursor";
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      tokens: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} in ('tokens_in','tokens_out') then ${usageFacts.amount} else 0 end), 0)`,
      tokensIn: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then ${usageFacts.amount} else 0 end), 0)`,
      tokensOut: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' then ${usageFacts.amount} else 0 end), 0)`,
      requests: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' and (${usageFacts.dimensionsJson}->>'subtype') is distinct from 'model_messages' then ${usageFacts.amount} else 0 end), 0)`
        : source === "claude_enterprise"
          // Skip the cost-endpoint request facts here to keep this number
          // aligned with the historical engagement-side definition (chat
          // messages, code sessions, etc.). The Tokens / Spend pages query
          // the cost-endpoint requests directly when they need the API-side
          // request count.
          ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' and ${usageFacts.externalId} not like 'claude_enterprise:cost_endpoint:%' then ${usageFacts.amount} else 0 end), 0)`
          : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
      costUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} not like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : source === "claude_enterprise"
          // Claude Enterprise writes cost_usd from three sources (per-user
          // rows, per-product bucket rows, per-model bucket rows). Each source
          // sums to the same per-day total. To avoid triple-counting in
          // Overview / Forecast / global rollup we count only the per-product
          // bucket. The dedicated Spend page queries the other prefixes
          // directly when it needs per-user / per-model breakdowns.
          ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} like 'claude_enterprise:cost:bucket:product:%' then ${usageFacts.amount} else 0 end), 0)`
          : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' then ${usageFacts.amount} else 0 end), 0)`,
      dau: sql<number>`coalesce(max(case when ${usageFacts.metricKind} = 'dau' then ${usageFacts.amount} end), 0)`,
      linesAdded: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_added' then ${usageFacts.amount} else 0 end), 0)`,
      credits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'credits' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({
    date: r.date,
    tokens: Number(r.tokens),
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    requests: Number(r.requests),
    costUsd: Number(r.costUsd),
    dau: Number(r.dau),
    linesAdded: Number(r.linesAdded),
    credits: Number(r.credits),
  }));
}

export type RankedMemberRow = {
  memberId: string | null;
  email: string | null;
  name: string | null;
  linesAdded: number;
  requests: number;
  cycleSpendUsd: number;
  windowSpendUsd: number;
  credits: number;
};

export async function getRankedMembers(filters: DashboardFilters, source: string, limit = 50): Promise<RankedMemberRow[]> {
  const db = getDb();
  const where = baseConditions(filters, source);
  const isCursor = source === "cursor";

  const rows = await db
    .select({
      memberId: dimMember.id,
      email: dimMember.email,
      name: dimMember.displayName,
      linesAdded: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_added' then ${usageFacts.amount} else 0 end), 0)`,
      requests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
      cycleSpendUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.externalId} like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : sql<number>`0`,
      windowSpendUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} not like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' then ${usageFacts.amount} else 0 end), 0)`,
      credits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'credits' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .innerJoin(dimMember, eq(usageFacts.memberId, dimMember.id))
    .where(where)
    .groupBy(dimMember.id, dimMember.email, dimMember.displayName)
    .orderBy(desc(sql`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`))
    .limit(limit);

  return rows.map((r) => ({
    memberId: r.memberId,
    email: r.email,
    name: r.name,
    linesAdded: Number(r.linesAdded),
    requests: Number(r.requests),
    cycleSpendUsd: Number(r.cycleSpendUsd),
    windowSpendUsd: Number(r.windowSpendUsd),
    credits: Number(r.credits),
  }));
}

export type ModelRow = {
  model: string;
  requests: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
};

export async function getRankedModels(filters: DashboardFilters, source: string, limit = 30): Promise<ModelRow[]> {
  const db = getDb();
  const isCursor = source === "cursor";

  const baseWhere = baseConditions(filters, source);

  if (isCursor) {
    const where = and(
      baseWhere,
      eq(usageFacts.metricKind, "requests"),
      sql`(${usageFacts.dimensionsJson}->>'subtype') = 'model_messages'`,
      sql`${usageFacts.modelName} is not null`,
    );

    const rows = await db
      .select({
        model: usageFacts.modelName,
        requests: sum(usageFacts.amount),
      })
      .from(usageFacts)
      .where(where)
      .groupBy(usageFacts.modelName)
      .orderBy(desc(sum(usageFacts.amount)))
      .limit(limit);

    return rows
      .filter((r) => r.model)
      .map((r) => ({ model: r.model as string, requests: Number(r.requests ?? 0), credits: 0, tokensIn: 0, tokensOut: 0 }));
  }

  const where = and(
    baseWhere,
    sql`${usageFacts.modelName} is not null`,
  );

  const rows = await db
    .select({
      model: usageFacts.modelName,
      requests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
      credits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'credits' then ${usageFacts.amount} else 0 end), 0)`,
      tokensIn: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then ${usageFacts.amount} else 0 end), 0)`,
      tokensOut: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(usageFacts.modelName)
    .orderBy(desc(sql`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then ${usageFacts.amount} else 0 end), 0) + coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' then ${usageFacts.amount} else 0 end), 0)`))
    .limit(limit);

  return rows
    .filter((r) => r.model)
    .map((r) => ({ model: r.model as string, requests: Number(r.requests ?? 0), credits: Number(r.credits ?? 0), tokensIn: Number(r.tokensIn ?? 0), tokensOut: Number(r.tokensOut ?? 0) }));
}

export async function getActiveBillingCycle(filters: DashboardFilters, source: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(billingCycles)
    .where(source === "global" ? undefined : eq(billingCycles.sourceSystem, source as any))
    .orderBy(desc(billingCycles.cycleStart))
    .limit(1);
  return row ?? null;
}

// --- V3 query functions ---

export type StackedTimeseriesRow = {
  date: string;
  dimension: string;
  value: number;
};

export async function getRequestsBySubtype(filters: DashboardFilters, source: string): Promise<StackedTimeseriesRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'subtype') in ('chat','agent','composer','usage_based')`,
  );
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  const dim = sql<string>`${usageFacts.dimensionsJson}->>'subtype'`;

  const rows = await db
    .select({
      date: bucket,
      dimension: dim,
      value: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket, dim)
    .orderBy(bucket);

  return rows.map((r) => ({ date: r.date, dimension: r.dimension, value: Number(r.value) }));
}

export type AgentEditsRow = {
  date: string;
  suggestedDiffs: number;
  acceptedDiffs: number;
  rejectedDiffs: number;
  linesSuggested: number;
  linesAccepted: number;
};

export async function getAgentEditsTimeseries(filters: DashboardFilters, source: string): Promise<AgentEditsRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'agent_edits'`,
  );
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      suggestedDiffs: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_suggested_diffs' then ${usageFacts.amount} else 0 end), 0)`,
      acceptedDiffs: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_accepted_diffs' then ${usageFacts.amount} else 0 end), 0)`,
      rejectedDiffs: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_rejected_diffs' then ${usageFacts.amount} else 0 end), 0)`,
      linesSuggested: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_lines_suggested' then ${usageFacts.amount} else 0 end), 0)`,
      linesAccepted: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_lines_accepted' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({
    date: r.date,
    suggestedDiffs: Number(r.suggestedDiffs),
    acceptedDiffs: Number(r.acceptedDiffs),
    rejectedDiffs: Number(r.rejectedDiffs),
    linesSuggested: Number(r.linesSuggested),
    linesAccepted: Number(r.linesAccepted),
  }));
}

export type TabsAnalyticsRow = {
  date: string;
  suggestions: number;
  accepts: number;
  rejects: number;
};

export async function getTabsAnalytics(filters: DashboardFilters, source: string): Promise<TabsAnalyticsRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'tabs'`,
  );
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      suggestions: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_suggestions' then ${usageFacts.amount} else 0 end), 0)`,
      accepts: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_accepts' then ${usageFacts.amount} else 0 end), 0)`,
      rejects: sql<number>`coalesce(sum(case when (${usageFacts.dimensionsJson}->>'field') = 'total_rejects' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({
    date: r.date,
    suggestions: Number(r.suggestions),
    accepts: Number(r.accepts),
    rejects: Number(r.rejects),
  }));
}

export type McpToolRow = { toolName: string; serverName: string; usage: number };

export async function getMcpUsage(filters: DashboardFilters, source: string): Promise<McpToolRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'mcp'`,
  );

  const rows = await db
    .select({
      toolName: sql<string>`${usageFacts.dimensionsJson}->>'tool_name'`,
      serverName: sql<string>`${usageFacts.dimensionsJson}->>'mcp_server_name'`,
      usage: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(
      sql`${usageFacts.dimensionsJson}->>'tool_name'`,
      sql`${usageFacts.dimensionsJson}->>'mcp_server_name'`,
    )
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`))
    .limit(100);

  return rows.map((r) => ({ toolName: r.toolName, serverName: r.serverName, usage: Number(r.usage) }));
}

export type CommandRow = { commandName: string; usage: number };

export async function getCommandUsage(filters: DashboardFilters, source: string): Promise<CommandRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'commands'`,
  );

  const rows = await db
    .select({
      commandName: sql<string>`${usageFacts.dimensionsJson}->>'command_name'`,
      usage: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(sql`${usageFacts.dimensionsJson}->>'command_name'`)
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`))
    .limit(50);

  return rows.map((r) => ({ commandName: r.commandName, usage: Number(r.usage) }));
}

export type FileExtRow = { extension: string; totalFiles: number; accepts: number; rejects: number };

export async function getFileExtensions(filters: DashboardFilters, source: string): Promise<FileExtRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'file_extensions'`,
  );

  const rows = await db
    .select({
      extension: sql<string>`${usageFacts.dimensionsJson}->>'file_extension'`,
      totalFiles: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      accepts: sql<number>`coalesce(sum((${usageFacts.dimensionsJson}->>'total_accepts')::numeric), 0)`,
      rejects: sql<number>`coalesce(sum((${usageFacts.dimensionsJson}->>'total_rejects')::numeric), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(sql`${usageFacts.dimensionsJson}->>'file_extension'`)
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`))
    .limit(50);

  return rows.map((r) => ({
    extension: r.extension,
    totalFiles: Number(r.totalFiles),
    accepts: Number(r.accepts),
    rejects: Number(r.rejects),
  }));
}

export type ClientVersionRow = { version: string; userCount: number; percentage: number };

export async function getClientVersions(filters: DashboardFilters, source: string): Promise<ClientVersionRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'client_versions'`,
  );

  const rows = await db
    .select({
      version: sql<string>`${usageFacts.dimensionsJson}->>'client_version'`,
      userCount: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      percentage: sql<number>`coalesce(avg((${usageFacts.dimensionsJson}->>'percentage')::numeric), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(sql`${usageFacts.dimensionsJson}->>'client_version'`)
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`))
    .limit(20);

  return rows.map((r) => ({
    version: r.version,
    userCount: Number(r.userCount),
    percentage: Number(r.percentage),
  }));
}

export type AiCommitRow = { repo: string; commits: number; linesAdded: number; linesDeleted: number };

export async function getAiCommits(filters: DashboardFilters, source: string): Promise<AiCommitRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "lines_added"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'ai_code_commit'`,
    sql`(${usageFacts.dimensionsJson}->>'kind') is distinct from 'deleted'`,
  );

  const rows = await db
    .select({
      repo: sql<string>`${usageFacts.dimensionsJson}->>'repo'`,
      commits: sql<number>`count(*)::int`,
      linesAdded: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      linesDeleted: sql<number>`coalesce(sum((${usageFacts.dimensionsJson}->>'lines_deleted')::numeric), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(sql`${usageFacts.dimensionsJson}->>'repo'`)
    .orderBy(desc(sql`count(*)`))
    .limit(30);

  return rows.map((r) => ({
    repo: r.repo,
    commits: Number(r.commits),
    linesAdded: Number(r.linesAdded),
    linesDeleted: Number(r.linesDeleted),
  }));
}

export type DauBreakdownRow = {
  date: string;
  totalDau: number;
  cliDau: number;
  cloudAgentDau: number;
  bugbotDau: number;
};

export async function getDauBreakdown(filters: DashboardFilters, source: string): Promise<DauBreakdownRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "dau"),
  );
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      totalDau: sql<number>`coalesce(max(${usageFacts.amount}), 0)`,
      cliDau: sql<number>`coalesce(max((${usageFacts.dimensionsJson}->>'cli_dau')::numeric), 0)`,
      cloudAgentDau: sql<number>`coalesce(max((${usageFacts.dimensionsJson}->>'cloud_agent_dau')::numeric), 0)`,
      bugbotDau: sql<number>`coalesce(max((${usageFacts.dimensionsJson}->>'bugbot_dau')::numeric), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  return rows.map((r) => ({
    date: r.date,
    totalDau: Number(r.totalDau),
    cliDau: Number(r.cliDau),
    cloudAgentDau: Number(r.cloudAgentDau),
    bugbotDau: Number(r.bugbotDau),
  }));
}

export type BillingGroupSpendRow = {
  groupId: string | null;
  groupName: string;
  totalSpend: number;
  memberCount: number;
};

export async function getBillingGroupSpend(filters: DashboardFilters, source: string): Promise<BillingGroupSpendRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "cost_usd"),
    sql`${usageFacts.billingGroupName} is not null`,
  );

  const rows = await db
    .select({
      groupId: usageFacts.billingGroupId,
      groupName: sql<string>`${usageFacts.billingGroupName}`,
      totalSpend: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      memberCount: sql<number>`count(distinct ${usageFacts.memberId})::int`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(usageFacts.billingGroupId, usageFacts.billingGroupName)
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`));

  return rows.map((r) => ({
    groupId: r.groupId,
    groupName: r.groupName ?? "Unassigned",
    totalSpend: Number(r.totalSpend),
    memberCount: Number(r.memberCount),
  }));
}

export type PlansRow = { model: string; usage: number };

export async function getPlansUsage(filters: DashboardFilters, source: string): Promise<PlansRow[]> {
  const db = getDb();
  const where = and(
    baseConditions(filters, source),
    eq(usageFacts.metricKind, "requests"),
    sql`(${usageFacts.dimensionsJson}->>'cursor_analytics') = 'plans'`,
  );

  const rows = await db
    .select({
      model: sql<string>`${usageFacts.modelName}`,
      usage: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(where)
    .groupBy(usageFacts.modelName)
    .orderBy(desc(sql`coalesce(sum(${usageFacts.amount}), 0)`));

  return rows.map((r) => ({ model: r.model ?? "Unknown", usage: Number(r.usage) }));
}

export type EnhancedMemberRow = RankedMemberRow & {
  role: string | null;
  linesDeleted: number;
  tabsShown: number;
  tabsAccepted: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
};

export async function getEnhancedRankedMembers(filters: DashboardFilters, source: string, limit = 50): Promise<EnhancedMemberRow[]> {
  const db = getDb();
  const where = baseConditions(filters, source);
  const isCursor = source === "cursor";

  const rows = await db
    .select({
      memberId: dimMember.id,
      email: dimMember.email,
      name: dimMember.displayName,
      role: dimMember.role,
      linesAdded: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_added' then ${usageFacts.amount} else 0 end), 0)`,
      linesDeleted: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'lines_deleted' then ${usageFacts.amount} else 0 end), 0)`,
      requests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
      cycleSpendUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.externalId} like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : sql<number>`0`,
      windowSpendUsd: isCursor
        ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} not like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
        : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' then ${usageFacts.amount} else 0 end), 0)`,
      tabsShown: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tabs_shown' then ${usageFacts.amount} else 0 end), 0)`,
      tabsAccepted: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tabs_accepted' then ${usageFacts.amount} else 0 end), 0)`,
      credits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'credits' then ${usageFacts.amount} else 0 end), 0)`,
      tokensIn: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then ${usageFacts.amount} else 0 end), 0)`,
      tokensOut: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .innerJoin(dimMember, eq(usageFacts.memberId, dimMember.id))
    .where(where)
    .groupBy(dimMember.id, dimMember.email, dimMember.displayName, dimMember.role)
    .orderBy(desc(sql`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`))
    .limit(limit);

  return rows.map((r) => ({
    memberId: r.memberId,
    email: r.email,
    name: r.name,
    role: r.role,
    linesAdded: Number(r.linesAdded),
    linesDeleted: Number(r.linesDeleted),
    requests: Number(r.requests),
    cycleSpendUsd: Number(r.cycleSpendUsd),
    windowSpendUsd: Number(r.windowSpendUsd),
    tabsShown: Number(r.tabsShown),
    tabsAccepted: Number(r.tabsAccepted),
    credits: Number(r.credits),
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
  }));
}

export async function getAllMembersWithUsage(filters: DashboardFilters, source: string, limit = 200): Promise<EnhancedMemberRow[]> {
  const db = getDb();
  const { from, to } = defaultRange(filters);

  const dateFilter = source === "global"
    ? and(gte(usageFacts.occurredAt, from), lte(usageFacts.occurredAt, to))
    : and(eq(usageFacts.sourceSystem, source as any), gte(usageFacts.occurredAt, from), lte(usageFacts.occurredAt, to));

  const sourceFilter = source === "global" ? undefined : eq(dimMember.sourceSystem, source as any);

  const rows = await db
    .select({
      memberId: dimMember.id,
      email: dimMember.email,
      name: dimMember.displayName,
      role: dimMember.role,
      requests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' and ${dateFilter} then ${usageFacts.amount} else 0 end), 0)`,
      tokensIn: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' and ${dateFilter} then ${usageFacts.amount} else 0 end), 0)`,
      tokensOut: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' and ${dateFilter} then ${usageFacts.amount} else 0 end), 0)`,
      windowSpendUsd: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${dateFilter} then ${usageFacts.amount} else 0 end), 0)`,
      credits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'credits' and ${dateFilter} then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(dimMember)
    .leftJoin(usageFacts, eq(usageFacts.memberId, dimMember.id))
    .where(sourceFilter)
    .groupBy(dimMember.id, dimMember.email, dimMember.displayName, dimMember.role)
    .orderBy(desc(sql`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`))
    .limit(limit);

  return rows.map((r) => ({
    memberId: r.memberId,
    email: r.email,
    name: r.name,
    role: r.role,
    requests: Number(r.requests),
    linesAdded: 0,
    linesDeleted: 0,
    cycleSpendUsd: 0,
    windowSpendUsd: Number(r.windowSpendUsd),
    tabsShown: 0,
    tabsAccepted: 0,
    credits: Number(r.credits),
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
  }));
}

export type CreditsByTypeRow = {
  date: string;
  usageType: string;
  credits: number;
};

export async function getCreditsByType(filters: DashboardFilters, source: string): Promise<CreditsByTypeRow[]> {
  const db = getDb();
  const { from, to } = defaultRange(filters);
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: bucket,
      usageType: usageFacts.modelName,
      credits: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        eq(usageFacts.sourceSystem, source as any),
        eq(usageFacts.metricKind, "credits" as any),
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
        sql`${usageFacts.modelName} is not null`,
      ),
    )
    .groupBy(bucket, usageFacts.modelName)
    .orderBy(bucket);

  return rows.map((r) => ({
    date: r.date,
    usageType: r.usageType ?? "unknown",
    credits: Number(r.credits),
  }));
}

export async function getAzureDimensions(filters: DashboardFilters): Promise<{ apps: string[]; models: string[] }> {
  const db = getDb();
  const { from, to } = defaultRange(filters);
  const dateConds = and(
    eq(usageFacts.sourceSystem, "azure" as any),
    gte(usageFacts.occurredAt, from),
    lte(usageFacts.occurredAt, to),
  );

  const [appRows, modelRows] = await Promise.all([
    db
      .selectDistinct({ name: usageFacts.billingGroupName })
      .from(usageFacts)
      .where(and(dateConds, sql`${usageFacts.billingGroupName} is not null`))
      .orderBy(usageFacts.billingGroupName),
    db
      .selectDistinct({ name: usageFacts.modelName })
      .from(usageFacts)
      .where(and(dateConds, sql`${usageFacts.modelName} is not null`))
      .orderBy(usageFacts.modelName),
  ]);

  return {
    apps: appRows.map((r) => r.name!),
    models: modelRows.map((r) => r.name!),
  };
}

export type AzureBreakdownRow = {
  app: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  requests: number;
  costUsd: number;
};

export async function getAzureUsageBreakdown(
  filters: DashboardFilters,
  source: string,
): Promise<AzureBreakdownRow[]> {
  const db = getDb();
  const where = baseConditions(filters, source);

  const rows = await db
    .select({
      app: usageFacts.billingGroupName,
      model: usageFacts.modelName,
      tokensIn: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_in' then ${usageFacts.amount} else 0 end), 0)`,
      tokensOut: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'tokens_out' then ${usageFacts.amount} else 0 end), 0)`,
      requests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(and(where, sql`${usageFacts.modelName} is not null`))
    .groupBy(usageFacts.billingGroupName, usageFacts.modelName)
    .orderBy(desc(sql`coalesce(sum(case when ${usageFacts.metricKind} in ('tokens_in','tokens_out') then ${usageFacts.amount} else 0 end), 0)`));

  return rows.map((r) => ({
    app: r.app ?? "Unknown",
    model: r.model ?? "Unknown",
    tokensIn: Number(r.tokensIn),
    tokensOut: Number(r.tokensOut),
    requests: Number(r.requests),
    costUsd: 0,
  }));
}
