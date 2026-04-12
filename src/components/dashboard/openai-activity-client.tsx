"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Hash, Download, Upload } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
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
};

const MODEL_COLUMNS: ColumnDef<ModelRow>[] = [
  { accessorKey: "model", header: "Model" },
  { 
    accessorKey: "requests", 
    header: "Requests", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

export function OpenAIActivityClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=openai` : `source=openai`;

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
        if (!tsRes.ok) throw new Error(tsJson.error ?? "Failed to load timeseries");

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries(tsJson.data as TimeseriesRow[]);
          setModels(modJson.data as ModelRow[]);
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
        <h2 className="text-base font-semibold">OpenAI Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  const tokensInTrend = computeTrend(timeseries.map((r) => r.tokensIn));
  const tokensOutTrend = computeTrend(timeseries.map((r) => r.tokensOut));
  const totalTokensIn = timeseries.reduce((sum, r) => sum + r.tokensIn, 0);
  const totalTokensOut = timeseries.reduce((sum, r) => sum + r.tokensOut, 0);

  const kpis: KpiItem[] = [
    {
      label: "Total Tokens",
      value: formatCompactNumber(summary.tokens),
      icon: Hash,
    },
    {
      label: "Tokens In",
      value: formatCompactNumber(totalTokensIn),
      icon: Download,
      trend: tokensInTrend.changePct,
    },
    {
      label: "Tokens Out",
      value: formatCompactNumber(totalTokensOut),
      icon: Upload,
      trend: tokensOutTrend.changePct,
    },
  ];

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
        syncId="openai-activity"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Disclosure title="Model Mix" persistKey="openai-models-open">
          <DataTable columns={MODEL_COLUMNS} data={models} />
        </Disclosure>
      </div>
    </div>
  );
}
