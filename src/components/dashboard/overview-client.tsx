"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Flame, Zap, Users, Code2, TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid, HeroBurndown, formatUsd, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart, SERIES_PRESETS } from "@/components/dashboard/timeseries-chart";
import { TrendBadge, computeTrend } from "./trend-badge";
import type { TimeseriesRow } from "@/server/metrics";

type Summary = {
  tokens: number;
  requests: number;
  cycleSpendUsd: number;
  windowSpendUsd: number;
  linesAdded: number;
  agentEditsAccepted: number;
  avgDau: number;
  memberCount: number;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
};

type BudgetData = {
  configured: boolean;
  budget?: { amount: number; label: string };
  metrics?: {
    spent: number;
    remaining: number;
    percentUsed: number;
    dailyBurnRate: number;
    daysUntilDepleted: number | null;
    projectedDepletionDate: string | null;
  };
};

export function OverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [series, setSeries] = useState<TimeseriesRow[]>([]);
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sRes, tRes, bRes] = await Promise.all([
          fetch(`/api/metrics/summary?source=cursor&${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?source=cursor&${qs}`, { cache: "no-store" }),
          fetch("/api/metrics/budget?source=cursor", { cache: "no-store" }),
        ]);
        const sJson = await sRes.json();
        const tJson = await tRes.json();
        const bJson = await bRes.json();
        if (!sRes.ok) throw new Error(sJson.error ?? "Failed to load summary");
        if (!tRes.ok) throw new Error(tJson.error ?? "Failed to load timeseries");
        if (cancelled) return;
        setSummary(sJson as Summary);
        setSeries(tJson.data as TimeseriesRow[]);
        setBudgetData(bJson as BudgetData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  const daysInWindow = useMemo(() => {
    const costDays = series.filter((r) => r.costUsd > 0).length;
    return costDays || 1;
  }, [series]);

  const kpis = useMemo<KpiItem[]>(() => {
    if (!summary) return [];
    const avgDaily = summary.windowSpendUsd / daysInWindow;
    
    const spendTrend = computeTrend(series.map((r) => r.costUsd));
    const requestsTrend = computeTrend(series.map((r) => r.requests));
    const dauTrend = computeTrend(series.map((r) => r.dau));
    const linesTrend = computeTrend(series.map((r) => r.linesAdded));

    return [
      {
        label: "Avg daily burn",
        value: formatUsd(avgDaily),
        hint: `Window spend / ${daysInWindow} days with spend data.`,
        icon: Flame,
        color: "var(--color-chart-5)",
        trend: spendTrend.changePct,
      },
      {
        label: "Requests",
        value: summary.requests.toLocaleString(),
        hint: "Non-analytics request counters from daily usage.",
        icon: Zap,
        color: "var(--color-chart-1)",
        trend: requestsTrend.changePct,
      },
      {
        label: "Active users",
        value: summary.avgDau.toFixed(0),
        hint: "Average daily active users in the window.",
        icon: Users,
        color: "var(--color-chart-4)",
        trend: dauTrend.changePct,
      },
      {
        label: "Lines added",
        value: summary.linesAdded.toLocaleString(),
        hint: "Total lines added across all members.",
        icon: Code2,
        color: "var(--color-chart-2)",
        trend: linesTrend.changePct,
      },
    ];
  }, [summary, daysInWindow, series]);

  const spendTrend = useMemo(
    () => computeTrend(series.map((r) => r.costUsd)),
    [series],
  );
  const requestsTrend = useMemo(
    () => computeTrend(series.map((r) => r.requests)),
    [series],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Could not load overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const hasBudget = budgetData?.configured && budgetData.metrics && budgetData.budget;

  return (
    <div className="space-y-6">
      {hasBudget && (
        <HeroBurndown
          spent={budgetData.metrics!.spent}
          total={budgetData.budget!.amount}
          remaining={budgetData.metrics!.remaining}
          percentUsed={budgetData.metrics!.percentUsed}
          depletionLabel={
            budgetData.metrics!.daysUntilDepleted != null
              ? `~${budgetData.metrics!.daysUntilDepleted} days until depleted at current rate`
              : "Depletion date unavailable"
          }
        />
      )}

      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Daily Spend</p>
              <p className="text-xs text-muted-foreground">
                {formatUsd(summary?.windowSpendUsd ?? 0)} total in window
              </p>
            </div>
            <TrendBadge changePct={spendTrend.changePct} />
          </div>
          <TimeseriesChart
            title="Daily Spend"
            description="Event-level and billing-group daily spend (USD)."
            data={series}
            series={SERIES_PRESETS.spend}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Daily Requests</p>
              <p className="text-xs text-muted-foreground">
                {(summary?.requests ?? 0).toLocaleString()} total in window
              </p>
            </div>
            <TrendBadge changePct={requestsTrend.changePct} />
          </div>
          <TimeseriesChart
            title="Daily Requests"
            description="Non-analytics requests from daily usage data."
            data={series}
            series={SERIES_PRESETS.activity}
          />
        </div>
      </div>
    </div>
  );
}
