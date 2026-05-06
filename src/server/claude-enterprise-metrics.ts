import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { usageFacts } from "@/db/schema";
import type { DashboardFilters } from "@/lib/filters";

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
