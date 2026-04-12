"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DollarSign, TrendingUp, CalendarClock, Layers } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid, formatUsd, type KpiItem } from "@/components/dashboard/kpi-grid";
import { MembersTable } from "@/components/dashboard/members-table";
import { TimeseriesChart, SERIES_PRESETS } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { TrendBadge, computeTrend } from "./trend-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RankedMemberRow, TimeseriesRow, BillingGroupSpendRow } from "@/server/metrics";

type Summary = {
  windowSpendUsd: number;
};

export function CostClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<RankedMemberRow[]>([]);
  const [series, setSeries] = useState<TimeseriesRow[]>([]);
  const [billingGroups, setBillingGroups] = useState<BillingGroupSpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sRes, rRes, tRes, bgRes] = await Promise.all([
          fetch(`/api/metrics/summary?source=cursor&${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/ranked?source=cursor&${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?source=cursor&${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/billing-groups?source=cursor&${qs}`, { cache: "no-store" }),
        ]);
        const sJson = await sRes.json();
        const rJson = await rRes.json();
        const tJson = await tRes.json();
        const bgJson = await bgRes.json();
        if (!sRes.ok) throw new Error(sJson.error ?? "Failed to load summary");
        if (!rRes.ok) throw new Error(rJson.error ?? "Failed to load ranked");
        if (!tRes.ok) throw new Error(tJson.error ?? "Failed to load timeseries");
        if (!cancelled) {
          setSummary({ windowSpendUsd: sJson.windowSpendUsd });
          setMembers(rJson.data as RankedMemberRow[]);
          setSeries(tJson.data as TimeseriesRow[]);
          setBillingGroups(bgRes.ok ? (bgJson.groups as BillingGroupSpendRow[]) : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => b.windowSpendUsd - a.windowSpendUsd),
    [members],
  );

  const daysWithSpend = useMemo(
    () => series.filter((r) => r.costUsd > 0).length || 1,
    [series],
  );

  const kpis = useMemo<KpiItem[]>(() => {
    if (!summary) return [];
    const avgDaily = summary.windowSpendUsd / daysWithSpend;
    const projectedMonthly = avgDaily * 30;

    const spendTrend = computeTrend(series.map((r) => r.costUsd));

    return [
      {
        label: "Total spend",
        value: formatUsd(summary.windowSpendUsd),
        hint: "Sum of cost entries in the selected date range.",
        icon: DollarSign,
        color: "var(--color-chart-5)",
        trend: spendTrend.changePct,
      },
      {
        label: "Avg daily spend",
        value: formatUsd(avgDaily),
        hint: `Window spend / ${daysWithSpend} days with spend data.`,
        icon: TrendingUp,
        color: "var(--color-chart-1)",
      },
      {
        label: "Projected monthly",
        value: formatUsd(projectedMonthly),
        hint: "Avg daily spend extrapolated to 30 days.",
        icon: CalendarClock,
        color: "var(--color-chart-4)",
      },
      {
        label: "Billing groups",
        value: String(billingGroups.length),
        hint: "Number of billing groups with spend data.",
        icon: Layers,
        color: "var(--color-chart-3)",
      },
    ];
  }, [summary, daysWithSpend, billingGroups.length, series]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Could not load cost data</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const barData = billingGroups.map((g) => ({
    name: g.groupName,
    value: g.totalSpend,
  }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <TimeseriesChart
        title="Daily Spend"
        description="Event-level and billing-group daily spend (USD)."
        data={series}
        series={SERIES_PRESETS.spend}
      />

      {billingGroups.length > 0 && (
        <>
          <HorizontalBarChart
            title="Spend by Billing Group"
            description="Total spend per group in the selected window."
            data={barData}
          />
          <div className="rounded-2xl bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold">Billing Group Details</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Total Spend</TableHead>
                  <TableHead className="text-right">Avg / Member</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billingGroups.map((g) => (
                  <TableRow key={g.groupId ?? g.groupName}>
                    <TableCell className="font-medium">{g.groupName}</TableCell>
                    <TableCell className="text-right">{g.memberCount}</TableCell>
                    <TableCell className="text-right">{formatUsd(g.totalSpend)}</TableCell>
                    <TableCell className="text-right">
                      {g.memberCount > 0 ? formatUsd(g.totalSpend / g.memberCount) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <MembersTable
        rows={sortedMembers}
        title="Members by spend"
        description="Sorted by window spend. Export matches the table."
      />
    </div>
  );
}
