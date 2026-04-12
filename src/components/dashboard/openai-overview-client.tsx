"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DollarSign, Hash, Activity, Users } from "lucide-react";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
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

export function OpenAIOverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=openai` : `source=openai`;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sumRes, tsRes] = await Promise.all([
          fetch(`/api/metrics/summary?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();

        if (!sumRes.ok) throw new Error(sumJson.error ?? "Failed to load summary");
        if (!tsRes.ok) throw new Error(tsJson.error ?? "Failed to load timeseries");

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries(tsJson.data as TimeseriesRow[]);
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
        <h2 className="text-base font-semibold">OpenAI Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  const spendTrend = computeTrend(timeseries.map((r) => r.costUsd));
  const tokensTrend = computeTrend(timeseries.map((r) => r.tokens));
  const requestsTrend = computeTrend(timeseries.map((r) => r.requests));

  const kpis: KpiItem[] = [
    {
      label: "Total Spend",
      value: formatUsd(summary.windowSpendUsd),
      icon: DollarSign,
      trend: spendTrend.changePct,
      trendLabel: "vs prev half",
    },
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
      label: "Active Users",
      value: formatCompactNumber(summary.activeUsers),
      icon: Users,
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />
      
      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily Spend"
          data={timeseries}
          series={[{ dataKey: "costUsd", name: "Spend", color: "var(--color-chart-1)", type: "area", yAxisId: "left" }]}
          syncId="openai"
        />
        <TimeseriesChart
          title="Daily Tokens"
          data={timeseries}
          series={[{ dataKey: "tokens", name: "Tokens", color: "var(--color-chart-2)", type: "area", yAxisId: "left" }]}
          syncId="openai"
        />
      </div>
    </div>
  );
}
