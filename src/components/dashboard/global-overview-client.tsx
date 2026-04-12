"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DollarSign, Hash, Activity, Sparkles } from "lucide-react";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { StackedTimeseriesChart } from "@/components/dashboard/stacked-timeseries-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { computeTrend } from "@/components/dashboard/trend-badge";

type SummaryData = {
  tokens: number;
  requests: number;
  windowSpendUsd: number;
};

type GlobalTimeseriesRow = {
  date: string;
  sourceSystem: string;
  costUsd: number;
  tokens: number;
  requests: number;
  credits: number;
};

export function GlobalOverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<GlobalTimeseriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sumRes, tsRes] = await Promise.all([
          fetch(`/api/metrics/summary?source=global&${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/global-timeseries?${qs}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();

        if (!sumRes.ok) throw new Error(sumJson.error ?? "Failed to load summary");
        if (!tsRes.ok) throw new Error(tsJson.error ?? "Failed to load timeseries");

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries(tsJson.data as GlobalTimeseriesRow[]);
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
  }, [qs]);

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
        <h2 className="text-base font-semibold">Global Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  // Compute trends for KPIs
  const dailySpend = new Map<string, number>();
  const dailyTokens = new Map<string, number>();
  const dailyRequests = new Map<string, number>();
  const dailyCredits = new Map<string, number>();

  for (const r of timeseries) {
    dailySpend.set(r.date, (dailySpend.get(r.date) ?? 0) + r.costUsd);
    dailyTokens.set(r.date, (dailyTokens.get(r.date) ?? 0) + r.tokens);
    dailyRequests.set(r.date, (dailyRequests.get(r.date) ?? 0) + r.requests);
    dailyCredits.set(r.date, (dailyCredits.get(r.date) ?? 0) + (r.credits ?? 0));
  }

  const dates = Array.from(dailySpend.keys()).sort();
  const spendTrend = computeTrend(dates.map(d => dailySpend.get(d) ?? 0));
  const tokensTrend = computeTrend(dates.map(d => dailyTokens.get(d) ?? 0));
  const requestsTrend = computeTrend(dates.map(d => dailyRequests.get(d) ?? 0));
  const totalCredits = dates.reduce((sum, d) => sum + (dailyCredits.get(d) ?? 0), 0);

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
    ...(totalCredits > 0
      ? [{
          label: "Enterprise Credits",
          value: formatCompactNumber(totalCredits),
          icon: Sparkles,
        }]
      : []),
  ];

  // Prepare data for stacked charts
  const chartDataMap = new Map<string, any>();
  const sources = new Set<string>();

  for (const r of timeseries) {
    if (!chartDataMap.has(r.date)) {
      chartDataMap.set(r.date, { date: r.date });
    }
    const entry = chartDataMap.get(r.date);
    entry[`${r.sourceSystem}_cost`] = r.costUsd;
    entry[`${r.sourceSystem}_tokens`] = r.tokens;
    entry[`${r.sourceSystem}_credits`] = r.credits ?? 0;
    sources.add(r.sourceSystem);
  }

  const chartData = Array.from(chartDataMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const sourceArray = Array.from(sources);

  const sourceColor = (s: string) =>
    s === "cursor" ? "var(--color-chart-1)" : s === "openai" ? "var(--color-chart-2)" : "var(--color-chart-4)";
  const sourceLabel = (s: string) =>
    s === "cursor" ? "Cursor" : s === "openai" ? "OpenAI API" : s === "openai_enterprise" ? "Enterprise" : s;

  const costKeys = sourceArray
    .filter(s => s !== "openai_enterprise")
    .map(s => ({ dataKey: `${s}_cost`, name: sourceLabel(s), color: sourceColor(s) }));
  const tokenKeys = sourceArray
    .filter(s => s !== "openai_enterprise")
    .map(s => ({ dataKey: `${s}_tokens`, name: sourceLabel(s), color: sourceColor(s) }));

  const hasCredits = sourceArray.includes("openai_enterprise");
  const creditKeys = hasCredits
    ? [{ dataKey: "openai_enterprise_credits", name: "Enterprise Credits", color: "var(--color-chart-4)" }]
    : [];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />
      
      <div className="grid gap-6 lg:grid-cols-2">
        <StackedTimeseriesChart title="Spend by Platform" data={chartData} keys={costKeys} syncId="global" />
        <StackedTimeseriesChart title="Tokens by Platform" data={chartData} keys={tokenKeys} syncId="global" />
      </div>
      {creditKeys.length > 0 && (
        <StackedTimeseriesChart title="Enterprise Credits" data={chartData} keys={creditKeys} syncId="global" />
      )}
    </div>
  );
}
