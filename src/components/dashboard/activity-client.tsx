"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Zap, Bot, MousePointerClick, Code2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid, formatRequests, type KpiItem } from "@/components/dashboard/kpi-grid";
import { StackedTimeseriesChart, type StackedSeriesConfig } from "@/components/dashboard/stacked-timeseries-chart";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { Disclosure } from "@/components/dashboard/disclosure";
import { formatCompactNumber } from "@/lib/format";
import { DataTable } from "@/components/dashboard/data-table";
import { TrendBadge, computeTrend } from "./trend-badge";
import type { ColumnDef } from "@tanstack/react-table";

import type {
  StackedTimeseriesRow,
  AgentEditsRow,
  TabsAnalyticsRow,
  McpToolRow,
  CommandRow,
  FileExtRow,
  PlansRow,
  ModelRow,
} from "@/server/metrics";

type ActivityData = {
  requestsByType: StackedTimeseriesRow[];
  agentEdits: AgentEditsRow[];
  tabs: TabsAnalyticsRow[];
  mcp: McpToolRow[];
  commands: CommandRow[];
  extensions: FileExtRow[];
  plans: PlansRow[];
  models: ModelRow[];
};

const REQUEST_TYPE_KEYS: StackedSeriesConfig[] = [
  { dataKey: "agent", name: "Agent", color: "var(--color-chart-1)" },
  { dataKey: "chat", name: "Chat", color: "var(--color-chart-2)" },
  { dataKey: "composer", name: "Composer", color: "var(--color-chart-3)" },
  { dataKey: "usage_based", name: "Usage-based", color: "var(--color-chart-4)" },
];

const MODEL_COLUMNS: ColumnDef<ModelRow>[] = [
  { accessorKey: "model", header: "Model" },
  { 
    accessorKey: "requests", 
    header: "Messages", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

const MCP_COLUMNS: ColumnDef<McpToolRow>[] = [
  { accessorKey: "toolName", header: "Tool" },
  { accessorKey: "serverName", header: "Server" },
  { 
    accessorKey: "usage", 
    header: "Usage", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

const COMMAND_COLUMNS: ColumnDef<CommandRow>[] = [
  { accessorKey: "commandName", header: "Command" },
  { 
    accessorKey: "usage", 
    header: "Usage", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

const EXTENSION_COLUMNS: ColumnDef<FileExtRow>[] = [
  { accessorKey: "extension", header: "Extension" },
  { 
    accessorKey: "totalFiles", 
    header: "Files", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  { 
    accessorKey: "accepts", 
    header: "Accepts", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  { 
    accessorKey: "rejects", 
    header: "Rejects", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

const PLANS_COLUMNS: ColumnDef<PlansRow>[] = [
  { accessorKey: "model", header: "Model" },
  { 
    accessorKey: "usage", 
    header: "Usage", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

function pivotRequests(rows: StackedTimeseriesRow[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const entry = map.get(r.date) ?? {};
    entry[r.dimension] = (entry[r.dimension] ?? 0) + r.value;
    map.set(r.date, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dims]) => ({ date, ...dims }));
}

export function ActivityClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [data, setData] = useState<ActivityData | null>(null);
  const [summary, setSummary] = useState<{ requests: number; linesAdded: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [actRes, sumRes] = await Promise.all([
          fetch(`/api/metrics/activity?source=cursor&${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/summary?source=cursor&${qs}`, { cache: "no-store" }),
        ]);
        const actJson = await actRes.json();
        const sumJson = await sumRes.json();
        if (!actRes.ok) throw new Error(actJson.error ?? "Failed to load activity");
        if (!sumRes.ok) throw new Error(sumJson.error ?? "Failed to load summary");
        if (cancelled) return;
        setData(actJson as ActivityData);
        setSummary({ requests: sumJson.requests, linesAdded: sumJson.linesAdded });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  const kpis = useMemo<KpiItem[]>(() => {
    if (!data || !summary) return [];
    const totalReqs = summary.requests;
    const agentReqs = data.requestsByType
      .filter((r) => r.dimension === "agent")
      .reduce((s, r) => s + r.value, 0);
    const totalShown = data.tabs.reduce((s, r) => s + r.suggestions, 0);
    const totalAccepts = data.tabs.reduce((s, r) => s + r.accepts, 0);
    const tabRate = totalShown > 0 ? ((totalAccepts / totalShown) * 100).toFixed(1) + "%" : "N/A";

    const requestsTrend = computeTrend(
      Array.from(
        data.requestsByType.reduce((map, r) => {
          map.set(r.date, (map.get(r.date) ?? 0) + r.value);
          return map;
        }, new Map<string, number>()).values()
      )
    );

    const agentTrend = computeTrend(
      data.requestsByType
        .filter((r) => r.dimension === "agent")
        .map((r) => r.value)
    );

    const tabRateTrend = computeTrend(
      data.tabs.map((r) => (r.suggestions > 0 ? (r.accepts / r.suggestions) * 100 : 0))
    );

    return [
      { 
        label: "Total requests", 
        value: formatRequests(totalReqs), 
        icon: Zap, 
        color: "var(--color-chart-1)", 
        hint: "All request types combined.",
        trend: requestsTrend.changePct,
      },
      { 
        label: "Agent requests", 
        value: `${formatCompactNumber(agentReqs)} (${totalReqs > 0 ? ((agentReqs / totalReqs) * 100).toFixed(0) : 0}%)`, 
        icon: Bot, 
        color: "var(--color-chart-3)", 
        hint: "Percentage of requests from agent mode.",
        trend: agentTrend.changePct,
      },
      { 
        label: "Tab accept rate", 
        value: tabRate, 
        icon: MousePointerClick, 
        color: "var(--color-chart-4)", 
        hint: "Accepted tab completions / shown.",
        trend: tabRateTrend.changePct,
      },
      { 
        label: "Lines added", 
        value: formatCompactNumber(summary.linesAdded), 
        icon: Code2, 
        color: "var(--color-chart-2)", 
        hint: "Total lines added across all members." 
      },
    ];
  }, [data, summary]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Could not load activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const pivotedRequests = pivotRequests(data.requestsByType);

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <StackedTimeseriesChart
        title="Requests by Type"
        description="Daily requests broken down by agent, chat, composer, and usage-based."
        data={pivotedRequests}
        keys={REQUEST_TYPE_KEYS}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Agent Edits"
          description="Suggested vs accepted diffs per day."
          data={data.agentEdits.map((r) => ({
            date: r.date,
            tokens: 0,
            tokensIn: 0,
            tokensOut: 0,
            requests: r.suggestedDiffs,
            costUsd: r.acceptedDiffs,
            dau: r.rejectedDiffs,
            linesAdded: 0,
            credits: 0,
          }))}
          series={[
            { dataKey: "requests", name: "Suggested", type: "area", yAxisId: "left", color: "var(--color-chart-1)" },
            { dataKey: "costUsd", name: "Accepted", type: "line", yAxisId: "left", color: "var(--color-chart-2)" },
            { dataKey: "dau", name: "Rejected", type: "line", yAxisId: "left", color: "var(--color-chart-5)" },
          ]}
        />
        <TimeseriesChart
          title="Tab Completions"
          description="Suggestions shown vs accepted per day."
          data={data.tabs.map((r) => ({
            date: r.date,
            tokens: 0,
            tokensIn: 0,
            tokensOut: 0,
            requests: r.suggestions,
            costUsd: r.accepts,
            dau: 0,
            linesAdded: 0,
            credits: 0,
          }))}
          series={[
            { dataKey: "requests", name: "Shown", type: "area", yAxisId: "left", color: "var(--color-chart-3)" },
            { dataKey: "costUsd", name: "Accepted", type: "line", yAxisId: "left", color: "var(--color-chart-2)" },
          ]}
        />
      </div>

      <Disclosure title="Model Mix" badge={data.models.length} defaultOpen persistKey="activity-models">
        <DataTable
          columns={MODEL_COLUMNS}
          data={data.models}
          emptyText="No model usage data."
        />
      </Disclosure>

      <Disclosure title="MCP Tools" badge={data.mcp.length} persistKey="activity-mcp">
        <DataTable
          columns={MCP_COLUMNS}
          data={data.mcp}
          emptyText="No MCP data."
        />
      </Disclosure>

      <Disclosure title="Commands" badge={data.commands.length} persistKey="activity-commands">
        <DataTable
          columns={COMMAND_COLUMNS}
          data={data.commands}
          emptyText="No command data."
        />
      </Disclosure>

      <Disclosure title="File Extensions" badge={data.extensions.length} persistKey="activity-extensions">
        <DataTable
          columns={EXTENSION_COLUMNS}
          data={data.extensions}
          emptyText="No file extension data."
        />
      </Disclosure>

      <Disclosure title="Plans" badge={data.plans.length} persistKey="activity-plans">
        <DataTable
          columns={PLANS_COLUMNS}
          data={data.plans}
          emptyText="No plans data."
        />
      </Disclosure>
    </div>
  );
}
