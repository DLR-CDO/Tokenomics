"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Hash, Activity, DollarSign, Server } from "lucide-react";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart, type SeriesConfig } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { computeTrend } from "@/components/dashboard/trend-badge";
import type { TimeseriesRow } from "@/server/metrics";

type SummaryData = {
  tokens: number;
  requests: number;
  windowSpendUsd: number;
  activeUsers: number;
};

type RankedModelRow = {
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
};

export function AzureOverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "azure";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [models, setModels] = useState<RankedModelRow[]>([]);
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
          setModels((modJson.data ?? []) as RankedModelRow[]);
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
        <h2 className="text-base font-semibold">Azure Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  const tokensTrend = computeTrend(timeseries.map(r => r.tokens));
  const requestsTrend = computeTrend(timeseries.map(r => r.requests));

  const hasCost = summary.windowSpendUsd > 0;
  const spendTrend = hasCost ? computeTrend(timeseries.map(r => r.costUsd)) : null;

  const kpis: KpiItem[] = [
    {
      label: "Total Tokens",
      value: formatCompactNumber(summary.tokens),
      icon: Hash,
      trend: tokensTrend.changePct,
      trendLabel: "vs prev half",
    },
    {
      label: "Total Requests",
      value: formatCompactNumber(summary.requests),
      icon: Activity,
      trend: requestsTrend.changePct,
      trendLabel: "vs prev half",
    },
    {
      label: "Deployments",
      value: String(models.length),
      icon: Server,
    },
  ];

  if (hasCost) {
    kpis.push({
      label: "Total Cost",
      value: formatUsd(summary.windowSpendUsd),
      icon: DollarSign,
      trend: spendTrend?.changePct,
      trendLabel: "vs prev half",
    });
  }

  const tokenSeries: SeriesConfig[] = [
    { dataKey: "tokensIn", name: "Tokens In", color: "var(--color-chart-1)", type: "area", yAxisId: "left" },
    { dataKey: "tokensOut", name: "Tokens Out", color: "var(--color-chart-2)", type: "area", yAxisId: "left" },
  ];

  const requestSeries: SeriesConfig[] = [
    { dataKey: "requests", name: "Requests", color: "var(--color-chart-3)", type: "area", yAxisId: "left" },
  ];

  const deploymentChartData = [...models]
    .sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut))
    .slice(0, 10)
    .map(m => ({ name: m.model, value: m.tokensIn + m.tokensOut }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily Tokens (In vs Out)"
          data={timeseries}
          series={tokenSeries}
          syncId="azure"
        />
        <TimeseriesChart
          title="Daily Requests"
          data={timeseries}
          series={requestSeries}
          syncId="azure"
        />
      </div>

      {deploymentChartData.length > 0 && (
        <HorizontalBarChart
          title="Top Deployments by Tokens"
          data={deploymentChartData}
          formatValue={formatCompactNumber}
        />
      )}
    </div>
  );
}
