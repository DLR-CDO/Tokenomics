"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, Users, UserCheck, MessageCircle, AlertTriangle, TrendingUp } from "lucide-react";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart, type SeriesConfig } from "@/components/dashboard/timeseries-chart";
import { StackedTimeseriesChart, type StackedSeriesConfig } from "@/components/dashboard/stacked-timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatCredits, formatUsd } from "@/lib/format";
import {
  computeEnterpriseCreditRates,
  formatCreditValuation,
  hasAnyCreditRate,
  valuateCredits,
} from "@/lib/enterprise-credits";
import { computeTrend } from "@/components/dashboard/trend-badge";

type SummaryData = {
  tokens: number;
  requests: number;
  windowSpendUsd: number;
  activeUsers: number;
  memberCount: number;
};

type TimeseriesRow = {
  date: string;
  costUsd: number;
  tokens: number;
  requests: number;
  credits: number;
  tokensIn: number;
  tokensOut: number;
};

type AllocationData = {
  configured: boolean;
  monthlyAllocation?: number;
  monthToDateCredits?: number;
  percentUsed?: number;
  daysRemaining?: number;
  billingStart?: string;
  billingEnd?: string;
  creditPoolConfigured?: boolean;
  overageRateConfigured?: boolean;
  freeCreditsPerSeatPerMonth?: number;
  seatCount?: number;
  monthlyCreditAllocation?: number;
  creditPercentUsed?: number;
  creditDailyBurn?: number;
  projectedCreditMonthEnd?: number;
  costPerOverageCreditUsd?: number;
  overageCredits?: number;
  overageCostUsd?: number;
  projectedOverageCredits?: number;
  projectedOverageCostUsd?: number;
};

type RankedMember = {
  email: string;
  name: string;
  credits: number;
  requests: number;
};

type CreditsByTypeRow = {
  date: string;
  usageType: string;
  credits: number;
};


export function OpenAIEnterpriseOverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "openai_enterprise";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [allocation, setAllocation] = useState<AllocationData | null>(null);
  const [topUsers, setTopUsers] = useState<RankedMember[]>([]);
  const [creditsByType, setCreditsByType] = useState<CreditsByTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sumRes, tsRes, allocRes, membersRes, cbtRes] = await Promise.all([
          fetch(`/api/metrics/summary?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/monthly-allocation?source=${source}`, { cache: "no-store" }),
          fetch(`/api/metrics/ranked?dimension=member&${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/credits-by-type?${fullQs}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();
        const allocJson = allocRes.ok ? await allocRes.json() : null;
        const membersJson = await membersRes.json();
        const cbtJson = cbtRes.ok ? await cbtRes.json() : null;

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries((tsJson.data ?? []) as TimeseriesRow[]);
          if (allocJson) setAllocation(allocJson as AllocationData);
          setTopUsers((membersJson.data ?? []) as RankedMember[]);
          setCreditsByType((cbtJson?.data ?? []) as CreditsByTypeRow[]);
        }
      } catch {
        /* handled by empty state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs]);

  const { pivotedData, stackedKeys } = useMemo(() => {
    if (creditsByType.length === 0) return { pivotedData: [], stackedKeys: [] as StackedSeriesConfig[] };

    const CHART_COLORS = [
      "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
      "var(--color-chart-4)", "var(--color-chart-5)", "#8b5cf6", "#f43f5e",
      "#06b6d4", "#84cc16", "#f59e0b",
    ];

    const typeSet = new Set<string>();
    const byDate = new Map<string, Record<string, number>>();
    for (const row of creditsByType) {
      typeSet.add(row.usageType);
      const bucket = byDate.get(row.date) ?? {};
      bucket[row.usageType] = (bucket[row.usageType] ?? 0) + row.credits;
      byDate.set(row.date, bucket);
    }

    const types = [...typeSet];
    const dates = [...byDate.keys()].sort();
    const pivoted = dates.map(date => {
      const entry: Record<string, unknown> = { date };
      const bucket = byDate.get(date) ?? {};
      for (const t of types) entry[t] = bucket[t] ?? 0;
      return entry;
    });

    const keys: StackedSeriesConfig[] = types
      .sort((a, b) => {
        const totalA = creditsByType.filter(r => r.usageType === a).reduce((s, r) => s + r.credits, 0);
        const totalB = creditsByType.filter(r => r.usageType === b).reduce((s, r) => s + r.credits, 0);
        return totalB - totalA;
      })
      .map((t, i) => ({
        dataKey: t,
        name: t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));

    return { pivotedData: pivoted, stackedKeys: keys };
  }, [creditsByType]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!summary) return null;

  const totalCredits = timeseries.reduce((s, r) => s + (r.credits ?? 0), 0);
  const creditTrend = computeTrend(timeseries.map(r => r.credits ?? 0));
  const requestTrend = computeTrend(timeseries.map(r => r.requests));

  const creditRates = computeEnterpriseCreditRates({
    monthlyDollarAllocation: allocation?.monthlyAllocation,
    monthlyCreditAllocation: allocation?.monthlyCreditAllocation,
    costPerOverageCreditUsd: allocation?.costPerOverageCreditUsd,
  });
  const ratesAvailable = hasAnyCreditRate(creditRates);
  const totalCreditsValuationLine = ratesAvailable
    ? formatCreditValuation(valuateCredits(totalCredits, creditRates))
    : null;

  const kpis: KpiItem[] = [
    {
      label: "Total Seats",
      value: String(summary.memberCount),
      icon: Users,
    },
    {
      label: "Active Users",
      value: String(summary.activeUsers),
      icon: UserCheck,
    },
    {
      label: "Credits Used",
      value: formatCredits(totalCredits),
      icon: Sparkles,
      trend: creditTrend.changePct,
      trendLabel: "vs prev half",
      ...(totalCreditsValuationLine ? { hint: totalCreditsValuationLine } : {}),
    },
    {
      label: "Total Requests",
      value: formatCompactNumber(summary.requests),
      icon: MessageCircle,
      trend: requestTrend.changePct,
      trendLabel: "vs prev half",
    },
  ];

  if (allocation?.configured && allocation.monthlyAllocation) {
    kpis.push({
      label: "Month Credit Usage",
      value: `${((allocation.percentUsed ?? 0)).toFixed(1)}%`,
      hint: `${formatCredits(allocation.monthToDateCredits ?? 0)} of ${formatCredits(allocation.monthlyAllocation)} allocation — ${allocation.daysRemaining ?? 0} days left`,
      icon: Sparkles,
      color: (allocation.percentUsed ?? 0) > 90 ? "var(--color-destructive)" : undefined,
    });
  }

  if (allocation?.creditPoolConfigured && allocation.monthlyCreditAllocation) {
    const creditPct = allocation.creditPercentUsed ?? 0;
    const mtd = allocation.monthToDateCredits ?? 0;
    const mtdValuationLine = ratesAvailable
      ? formatCreditValuation(valuateCredits(mtd, creditRates))
      : null;
    const baseHint = `${formatCredits(mtd)} of ${formatCredits(allocation.monthlyCreditAllocation)} allowance — ${allocation.daysRemaining ?? 0} days left`;
    kpis.push({
      label: "Credit Allowance Used",
      value: `${creditPct.toFixed(1)}%`,
      hint: mtdValuationLine ? `${baseHint} · ${mtdValuationLine}` : baseHint,
      icon: Sparkles,
      color: creditPct >= 100 ? "var(--color-destructive)" : creditPct >= 80 ? "var(--color-chart-3)" : undefined,
    });
  }

  if (allocation?.overageRateConfigured && (allocation.overageCredits ?? 0) > 0) {
    kpis.push({
      label: "Overage Cost (MTD)",
      value: formatUsd(allocation.overageCostUsd ?? 0),
      hint: `${formatCredits(allocation.overageCredits ?? 0)} over allowance @ ${formatUsd(allocation.costPerOverageCreditUsd ?? 0)}/credit`,
      icon: AlertTriangle,
      color: "var(--color-destructive)",
    });
  }

  if (allocation?.overageRateConfigured && (allocation.projectedOverageCredits ?? 0) > 0) {
    const projected = allocation.projectedCreditMonthEnd ?? 0;
    const projectedValuationLine = ratesAvailable
      ? formatCreditValuation(valuateCredits(projected, creditRates))
      : null;
    const baseHint = `Projected ${formatCredits(projected)} by cycle end (${formatCredits(allocation.projectedOverageCredits ?? 0)} over allowance)`;
    kpis.push({
      label: "Projected Overage Cost",
      value: formatUsd(allocation.projectedOverageCostUsd ?? 0),
      hint: projectedValuationLine ? `${baseHint} · ${projectedValuationLine}` : baseHint,
      icon: TrendingUp,
      color: "var(--color-destructive)",
    });
  }

  const dailyCreditSeries: SeriesConfig[] = [
    { dataKey: "credits", name: "Credits", color: "var(--color-chart-4)", type: "area", yAxisId: "left" },
  ];

  const dailyRequestSeries: SeriesConfig[] = [
    { dataKey: "requests", name: "Requests", color: "var(--color-chart-2)", type: "area", yAxisId: "left" },
  ];

  const userChartData = topUsers
    .filter(u => u.credits > 0)
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 10)
    .map(u => ({
      name: u.name || u.email?.split("@")[0] || "Unknown",
      value: u.credits,
    }));

  const creditPct = allocation?.creditPercentUsed ?? 0;
  const creditPctClamped = Math.min(100, creditPct);
  const showCreditPool = Boolean(
    allocation?.creditPoolConfigured && allocation.monthlyCreditAllocation && allocation.monthlyCreditAllocation > 0,
  );

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      {showCreditPool && allocation ? (
        (() => {
          const mtd = allocation.monthToDateCredits ?? 0;
          const allowance = allocation.monthlyCreditAllocation ?? 0;
          const remaining = Math.max(0, allowance - mtd);
          const mtdValuation = ratesAvailable ? valuateCredits(mtd, creditRates) : null;
          const remainingValuation = ratesAvailable ? valuateCredits(remaining, creditRates) : null;
          const usageParts: string[] = [];
          if (mtdValuation?.overageUsd !== undefined) {
            usageParts.push(`≈ ${formatUsd(mtdValuation.overageUsd)} used`);
          }
          if (remainingValuation?.overageUsd !== undefined) {
            usageParts.push(`${formatUsd(remainingValuation.overageUsd)} remaining at overage rate`);
          } else if (
            mtdValuation?.overageUsd === undefined &&
            mtdValuation?.impliedUsd !== undefined
          ) {
            usageParts.push(`~ ${formatUsd(mtdValuation.impliedUsd)} contract value used`);
          }
          const usageLine = usageParts.join(" · ");

          return (
            <div className="rounded-2xl bg-card p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Monthly credit allowance</h3>
                  <p className="text-xs text-muted-foreground">
                    {formatCredits(mtd)} of {formatCredits(allowance)} used · {allocation.daysRemaining ?? 0} days left in cycle
                    {allocation.billingStart && allocation.billingEnd ? ` (${allocation.billingStart} → ${allocation.billingEnd})` : ""}
                  </p>
                  {usageLine ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{usageLine}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">{creditPct.toFixed(1)}%</span>
                  {allocation.overageRateConfigured && (allocation.overageCostUsd ?? 0) > 0 ? (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                      + {formatUsd(allocation.overageCostUsd ?? 0)} overage
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${creditPctClamped}%`,
                    backgroundColor:
                      creditPct >= 100
                        ? "var(--color-destructive)"
                        : creditPct >= 80
                          ? "var(--color-chart-3)"
                          : "var(--color-chart-1)",
                  }}
                />
              </div>
            </div>
          );
        })()
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily Credits"
          data={timeseries}
          series={dailyCreditSeries}
          syncId="oe"
        />
        <TimeseriesChart
          title="Daily Requests"
          data={timeseries}
          series={dailyRequestSeries}
          syncId="oe"
        />
      </div>

      {pivotedData.length > 0 && stackedKeys.length > 0 && (
        <StackedTimeseriesChart
          title="Credits by Usage Type"
          data={pivotedData}
          keys={stackedKeys}
          syncId="oe"
        />
      )}

      {userChartData.length > 0 && (
        <HorizontalBarChart
          title="Top Users by Credits"
          data={userChartData}
          formatValue={formatCredits}
          tooltipDetail={
            ratesAvailable
              ? (value) => formatCreditValuation(valuateCredits(value, creditRates))
              : undefined
          }
        />
      )}
    </div>
  );
}
