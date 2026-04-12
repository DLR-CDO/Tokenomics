import { and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { usageFacts } from "@/db/schema";
import type { DashboardFilters } from "@/lib/filters";

function defaultRange(filters: DashboardFilters): { from: Date; to: Date } {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export type GlobalTimeseriesRow = {
  date: string;
  sourceSystem: string;
  costUsd: number;
  tokens: number;
  requests: number;
  credits: number;
};

export async function getGlobalTimeseries(filters: DashboardFilters): Promise<GlobalTimeseriesRow[]> {
  const db = getDb();
  const { from, to } = defaultRange(filters);
  const bucket = sql<string>`to_char(${usageFacts.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  const source = usageFacts.sourceSystem;

  const rows = await db
    .select({
      date: bucket,
      sourceSystem: source,
      costUsd: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} not like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`,
      tokens: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} in ('tokens_in','tokens_out') then ${usageFacts.amount} else 0 end), 0)`,
      requests: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'requests' then ${usageFacts.amount} else 0 end), 0)`,
      credits: sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'credits' then ${usageFacts.amount} else 0 end), 0)`,
    })
    .from(usageFacts)
    .where(
      and(
        gte(usageFacts.occurredAt, from),
        lte(usageFacts.occurredAt, to),
      )
    )
    .groupBy(bucket, source)
    .orderBy(bucket);

  return rows.map(r => ({
    date: r.date,
    sourceSystem: r.sourceSystem,
    costUsd: Number(r.costUsd),
    tokens: Number(r.tokens),
    requests: Number(r.requests),
    credits: Number(r.credits),
  }));
}
