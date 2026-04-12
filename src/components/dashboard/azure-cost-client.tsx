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

const RESOURCE_COLUMNS: ColumnDef<BillingGroupSpendRow>[] = [
  { accessorKey: "groupName", header: "Resource" },
  {
    accessorKey: "totalSpend",
    header: "Total Spend",
    cell: (ctx) => formatUsd(Number(ctx.getValue())),
  },
];

export function AzureCostClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "azure";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [resources, setResources] = useState<BillingGroupSpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [tsRes, bgRes] = await Promise.all([
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/billing-groups?${fullQs}`, { cache: "no-store" }),
        ]);
        const tsJson = await tsRes.json();
        const bgJson = await bgRes.json();

        if (!cancelled) {
          setTimeseries((tsJson.data ?? []) as TimeseriesRow[]);
          setResources((bgJson.groups ?? []) as BillingGroupSpendRow[]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
        <h2 className="text-base font-semibold">Azure Cost</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const totalSpend = timeseries.reduce((s, r) => s + r.costUsd, 0);
  const spendTrend = computeTrend(timeseries.map(r => r.costUsd));

  const kpis: KpiItem[] = [
    {
      label: "Total Spend",
      value: totalSpend > 0 ? formatUsd(totalSpend) : "No cost data",
      icon: DollarSign,
      trend: totalSpend > 0 ? spendTrend.changePct : undefined,
    },
    {
      label: "Resources",
      value: String(resources.length),
      icon: Layers,
    },
  ];

  const chartData = resources.slice(0, 10).map(g => ({
    name: g.groupName,
    value: g.totalSpend,
  }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        {totalSpend > 0 ? (
          <TimeseriesChart
            title="Daily Spend"
            data={timeseries}
            series={[{ dataKey: "costUsd", name: "Spend", color: "var(--color-chart-1)", type: "area", yAxisId: "left" }]}
          />
        ) : (
          <div className="rounded-2xl bg-card p-5 shadow-sm flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            Cost data unavailable for some subscriptions (RBAC denied).
          </div>
        )}

        {chartData.length > 0 ? (
          <HorizontalBarChart title="Spend by Resource" data={chartData} />
        ) : (
          <div className="rounded-2xl bg-card p-5 shadow-sm flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            No resource cost breakdown available.
          </div>
        )}
      </div>

      {resources.length > 0 && (
        <Disclosure title="All Resources" persistKey="azure-resources-open">
          <DataTable columns={RESOURCE_COLUMNS} data={resources} />
        </Disclosure>
      )}
    </div>
  );
}
