"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DollarSign, Layers, TrendingUp, AlertTriangle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { computeTrend } from "@/components/dashboard/trend-badge";
import { Disclosure } from "@/components/dashboard/disclosure";
import type { TimeseriesRow } from "@/server/metrics";

type BillingGroupSpendRow = {
  groupId: string | null;
  groupName: string;
  totalSpend: number;
  memberCount: number;
};

type ListRatePoint = {
  date: string;
  listRateUsd: number;
  billedUsd: number;
};

type ListRateByModel = {
  model: string;
  listRateUsd: number;
  billedUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  hasRate: boolean;
};

type ListRateResult = {
  data: ListRatePoint[];
  byModel: ListRateByModel[];
  unmappedModels: string[];
  totals: {
    listRateUsd: number;
    billedUsd: number;
    driftPct: number | null;
  };
};

const PROJECT_COLUMNS: ColumnDef<BillingGroupSpendRow>[] = [
  { accessorKey: "groupName", header: "Project" },
  {
    accessorKey: "totalSpend",
    header: "Total Spend",
    cell: (ctx) => formatUsd(Number(ctx.getValue())),
  },
];

const MODEL_LIST_RATE_COLUMNS: ColumnDef<ListRateByModel>[] = [
  { accessorKey: "model", header: "Model" },
  {
    accessorKey: "tokensIn",
    header: "Tokens In",
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  {
    accessorKey: "tokensOut",
    header: "Tokens Out",
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  {
    accessorKey: "cachedTokens",
    header: "Cached In",
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  {
    accessorKey: "listRateUsd",
    header: "List-rate cost",
    cell: (ctx) => {
      const row = ctx.row.original;
      if (!row.hasRate) return <span className="text-muted-foreground">no rate</span>;
      return formatUsd(Number(ctx.getValue()));
    },
  },
];

export function OpenAICostClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=openai` : `source=openai`;
  const listRateQs = qs;

  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [projects, setProjects] = useState<BillingGroupSpendRow[]>([]);
  const [listRate, setListRate] = useState<ListRateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [tsRes, projRes, listRateRes] = await Promise.all([
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/billing-groups?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/openai-list-rate-cost?${listRateQs}`, { cache: "no-store" }),
        ]);
        const tsJson = await tsRes.json();
        const projJson = await projRes.json();
        const listRateJson = await listRateRes.json();

        if (!tsRes.ok) throw new Error(tsJson.error ?? "Failed to load timeseries");
        if (!projRes.ok) throw new Error(projJson.error ?? "Failed to load projects");

        if (!cancelled) {
          setTimeseries(tsJson.data as TimeseriesRow[]);
          setProjects(projJson.groups as BillingGroupSpendRow[]);
          if (listRateRes.ok) setListRate(listRateJson as ListRateResult);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fullQs, listRateQs]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">OpenAI Cost</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const spendTrend = computeTrend(timeseries.map((r) => r.costUsd));
  const totalSpend = timeseries.reduce((sum, r) => sum + r.costUsd, 0);

  const billedByDate = new Map<string, number>(timeseries.map((r) => [r.date, r.costUsd]));
  const listRateByDate = new Map<string, number>((listRate?.data ?? []).map((p) => [p.date, p.listRateUsd]));
  const allDates = new Set<string>([...billedByDate.keys(), ...listRateByDate.keys()]);
  const mergedTimeseries = Array.from(allDates)
    .sort()
    .map((d) => ({
      date: d,
      costUsd: billedByDate.get(d) ?? 0,
      listRateUsd: listRateByDate.get(d) ?? 0,
    }));

  const driftPct = listRate?.totals.driftPct ?? null;
  const driftAbsPct = driftPct !== null ? Math.abs(driftPct) : null;
  const driftColor =
    driftAbsPct === null
      ? undefined
      : driftAbsPct >= 15
        ? "var(--color-destructive)"
        : driftAbsPct >= 5
          ? "var(--color-chart-3)"
          : undefined;

  const hasListRate = listRate !== null && listRate.totals.listRateUsd > 0;

  const kpis: KpiItem[] = [
    {
      label: "Billed Spend",
      value: formatUsd(totalSpend),
      icon: DollarSign,
      trend: spendTrend.changePct,
    },
    {
      label: "Active Projects",
      value: String(projects.length),
      icon: Layers,
    },
  ];

  if (hasListRate) {
    kpis.push({
      label: "List-rate Spend",
      value: formatUsd(listRate!.totals.listRateUsd),
      icon: TrendingUp,
      hint: "Synthetic estimate using the public OpenAI pricing page rates against tokens_in/out and cached input.",
    });
    if (driftPct !== null) {
      kpis.push({
        label: "Drift vs list-rate",
        value: `${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}%`,
        icon: AlertTriangle,
        color: driftColor,
        hint: "(Billed - List-rate) / List-rate. Amber at >5%, red at >15%.",
      });
    }
  }

  const projectChartData = projects.slice(0, 10).map((g) => ({
    name: g.groupName,
    value: g.totalSpend,
  }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      {listRate && listRate.unmappedModels.length > 0 && (
        <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>{listRate.unmappedModels.length} model(s)</strong> have token usage but no list rate. The list-rate
          cost for these is treated as $0:{" "}
          <code className="font-mono">{listRate.unmappedModels.slice(0, 8).join(", ")}</code>
          {listRate.unmappedModels.length > 8 ? "…" : ""}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily Spend"
          description={hasListRate ? "Solid: billed by OpenAI · Dashed: list-rate estimate" : undefined}
          data={mergedTimeseries}
          series={[
            { dataKey: "costUsd", name: "Billed", color: "var(--color-chart-1)", type: "area", yAxisId: "left" },
            ...(hasListRate
              ? [
                  {
                    dataKey: "listRateUsd",
                    name: "List-rate",
                    color: "var(--color-chart-3)",
                    type: "line" as const,
                    yAxisId: "left" as const,
                    strokeDasharray: "5 4",
                  },
                ]
              : []),
          ]}
        />

        {projectChartData.length > 0 ? (
          <HorizontalBarChart title="Top Projects by Spend" data={projectChartData} />
        ) : (
          <div className="rounded-2xl bg-card p-5 shadow-sm flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            No project spend data available.
          </div>
        )}
      </div>

      <Disclosure title="All Projects" persistKey="openai-projects-open">
        <DataTable columns={PROJECT_COLUMNS} data={projects} />
      </Disclosure>

      {listRate && listRate.byModel.length > 0 && (
        <Disclosure title="Model list-rate breakdown" persistKey="openai-list-rate-models-open">
          <DataTable columns={MODEL_LIST_RATE_COLUMNS} data={listRate.byModel} />
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Per-model billed cost is not available because OpenAI&apos;s organization cost API does not break out cost
            by model. The list-rate column is a synthetic estimate.
          </p>
        </Disclosure>
      )}
    </div>
  );
}
