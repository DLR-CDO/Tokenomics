"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DollarSign, Layers } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format";
import { computeTrend } from "@/components/dashboard/trend-badge";
import { Disclosure } from "@/components/dashboard/disclosure";
import type { TimeseriesRow } from "@/server/metrics";

type BillingGroupSpendRow = {
  groupId: string | null;
  groupName: string;
  totalSpend: number;
  memberCount: number;
};

const PROJECT_COLUMNS: ColumnDef<BillingGroupSpendRow>[] = [
  { accessorKey: "groupName", header: "Project" },
  { 
    accessorKey: "totalSpend", 
    header: "Total Spend", 
    cell: (ctx) => formatUsd(Number(ctx.getValue())),
  },
];

export function OpenAICostClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=openai` : `source=openai`;

  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [projects, setProjects] = useState<BillingGroupSpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [tsRes, projRes] = await Promise.all([
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/billing-groups?${fullQs}`, { cache: "no-store" }),
        ]);
        const tsJson = await tsRes.json();
        const projJson = await projRes.json();

        if (!tsRes.ok) throw new Error(tsJson.error ?? "Failed to load timeseries");
        if (!projRes.ok) throw new Error(projJson.error ?? "Failed to load projects");

        if (!cancelled) {
          setTimeseries(tsJson.data as TimeseriesRow[]);
          setProjects(projJson.groups as BillingGroupSpendRow[]);
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
  }, [fullQs]);

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

  const kpis: KpiItem[] = [
    {
      label: "Total Spend",
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

  const projectChartData = projects.slice(0, 10).map((g) => ({
    name: g.groupName,
    value: g.totalSpend,
  }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />
      
      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily Spend"
          data={timeseries}
          series={[{ dataKey: "costUsd", name: "Spend", color: "var(--color-chart-1)", type: "area", yAxisId: "left" }]}
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
    </div>
  );
}
