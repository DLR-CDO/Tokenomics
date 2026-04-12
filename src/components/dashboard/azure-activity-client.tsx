"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Hash, Download, Upload, Server } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";
import { computeTrend } from "@/components/dashboard/trend-badge";
import { Disclosure } from "@/components/dashboard/disclosure";
import type { TimeseriesRow } from "@/server/metrics";

type SummaryData = {
  tokens: number;
  requests: number;
};

type ModelRow = {
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
};

export function AzureActivityClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "azure";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sumRes, tsRes, modRes] = await Promise.all([
          fetch(`/api/metrics/summary?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/ranked?dimension=model&${fullQs}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();
        const modJson = await modRes.json();

        if (!sumRes.ok) throw new Error(sumJson.error ?? "Failed to load summary");

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries((tsJson.data ?? []) as TimeseriesRow[]);
          setModels((modJson.data ?? []) as ModelRow[]);
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
        <h2 className="text-base font-semibold">Azure Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  const tokensInTrend = computeTrend(timeseries.map(r => r.tokensIn));
  const tokensOutTrend = computeTrend(timeseries.map(r => r.tokensOut));
  const totalTokensIn = timeseries.reduce((s, r) => s + r.tokensIn, 0);
  const totalTokensOut = timeseries.reduce((s, r) => s + r.tokensOut, 0);

  const kpis: KpiItem[] = [
    { label: "Total Tokens", value: formatCompactNumber(summary.tokens), icon: Hash },
    { label: "Tokens In", value: formatCompactNumber(totalTokensIn), icon: Download, trend: tokensInTrend.changePct },
    { label: "Tokens Out", value: formatCompactNumber(totalTokensOut), icon: Upload, trend: tokensOutTrend.changePct },
    { label: "Deployments", value: String(models.length), icon: Server },
  ];

  const MODEL_COLUMNS: ColumnDef<ModelRow, unknown>[] = [
    { accessorKey: "model", header: "Deployment" },
    {
      id: "totalTokens",
      header: "Tokens",
      accessorFn: (row) => row.tokensIn + row.tokensOut,
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensIn",
      header: "Tokens In",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensOut",
      header: "Tokens Out",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "requests",
      header: "Requests",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
  ];

  const deploymentChartData = [...models]
    .sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut))
    .slice(0, 10)
    .map(m => ({ name: m.model, value: m.tokensIn + m.tokensOut }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <TimeseriesChart
        title="Tokens In vs Out"
        data={timeseries}
        series={[
          { dataKey: "tokensIn", name: "Tokens In", color: "var(--color-chart-1)", type: "area", yAxisId: "left" },
          { dataKey: "tokensOut", name: "Tokens Out", color: "var(--color-chart-2)", type: "area", yAxisId: "left" },
        ]}
        syncId="azure-activity"
      />

      {deploymentChartData.length > 0 && (
        <HorizontalBarChart
          title="Top Deployments by Tokens"
          data={deploymentChartData}
          formatValue={formatCompactNumber}
        />
      )}

      <Disclosure title="All Deployments" persistKey="azure-models-open">
        <DataTable columns={MODEL_COLUMNS} data={models} />
      </Disclosure>
    </div>
  );
}
