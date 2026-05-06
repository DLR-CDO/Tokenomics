"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, UserCheck, MessageCircle, GitCommit, GitPullRequest, Code2 } from "lucide-react";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import type { TimeseriesRow } from "@/server/metrics";

type SummaryData = {
  tokens: number;
  requests: number;
  windowSpendUsd: number;
  activeUsers: number;
  memberCount: number;
};

type SeatSnapshot = {
  capturedOn: string;
  assignedSeats: number;
  pendingInvites: number;
  dau: number;
  wau: number;
  mau: number;
};

type ExtendedTotals = {
  commits: number;
  pullRequests: number;
  linesAdded: number;
  linesDeleted: number;
  sessions: number;
};

type SeatConfig = {
  annualCost?: number;
  seatCount?: number;
  billingResetDay?: number;
};

export function ClaudeEnterpriseOverviewClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "claude_enterprise";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [snapshot, setSnapshot] = useState<SeatSnapshot | null>(null);
  const [extended, setExtended] = useState<ExtendedTotals | null>(null);
  const [seatConfig, setSeatConfig] = useState<SeatConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sumRes, tsRes, snapRes, extRes, seatRes] = await Promise.all([
          fetch(`/api/metrics/summary?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch("/api/settings/claude-enterprise/snapshot", { cache: "no-store" }),
          fetch(`/api/metrics/claude-enterprise-totals?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/settings/seats?source=${source}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();
        const snapJson = snapRes.ok ? await snapRes.json() : null;
        const extJson = extRes.ok ? await extRes.json() : null;
        const seatJson = seatRes.ok ? await seatRes.json() : null;

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries((tsJson.data ?? []) as TimeseriesRow[]);
          if (snapJson?.snapshot) setSnapshot(snapJson.snapshot as SeatSnapshot);
          if (extJson?.totals) setExtended(extJson.totals as ExtendedTotals);
          if (seatJson?.config) setSeatConfig(seatJson.config as SeatConfig);
        }
      } catch {
        /* empty state handled below */
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

  if (!summary) return null;

  const monthlySeatValue =
    seatConfig?.annualCost && seatConfig.annualCost > 0 ? seatConfig.annualCost / 12 : null;

  const kpis: KpiItem[] = [
    {
      label: "Assigned Seats",
      value: String(snapshot?.assignedSeats ?? summary.memberCount),
      hint: snapshot
        ? `${snapshot.pendingInvites} pending invite${snapshot.pendingInvites === 1 ? "" : "s"}`
        : undefined,
      icon: Users,
    },
    {
      label: "DAU · WAU · MAU",
      value: snapshot
        ? `${snapshot.dau} · ${snapshot.wau} · ${snapshot.mau}`
        : String(summary.activeUsers),
      hint: snapshot ? `Latest snapshot: ${snapshot.capturedOn}` : undefined,
      icon: UserCheck,
    },
    {
      label: "Messages (window)",
      value: formatCompactNumber(summary.requests),
      icon: MessageCircle,
    },
  ];

  if (monthlySeatValue != null) {
    kpis.push({
      label: "Contract Value / month",
      value: formatUsd(monthlySeatValue),
      hint: seatConfig?.seatCount
        ? `${seatConfig.seatCount} seats · ${formatUsd(monthlySeatValue / seatConfig.seatCount)} / seat`
        : undefined,
      icon: Code2,
    });
  }

  if (extended) {
    if (extended.commits > 0) {
      kpis.push({
        label: "Commits (Claude Code)",
        value: formatCompactNumber(extended.commits),
        icon: GitCommit,
      });
    }
    if (extended.pullRequests > 0) {
      kpis.push({
        label: "PRs (Claude Code)",
        value: formatCompactNumber(extended.pullRequests),
        icon: GitPullRequest,
      });
    }
  }

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily Active Users"
          data={timeseries}
          series={[{ dataKey: "dau", name: "DAU", color: "var(--color-chart-1)", type: "area", yAxisId: "left" }]}
          syncId="cl-ent"
        />
        <TimeseriesChart
          title="Daily Messages"
          data={timeseries}
          series={[{ dataKey: "requests", name: "Messages", color: "var(--color-chart-2)", type: "area", yAxisId: "left" }]}
          syncId="cl-ent"
        />
      </div>

      {extended && (extended.linesAdded > 0 || extended.linesDeleted > 0 || extended.sessions > 0) ? (
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">Claude Code output (window)</h3>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-muted-foreground">Lines added</div>
              <div className="text-lg font-semibold">{formatCompactNumber(extended.linesAdded)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Lines removed</div>
              <div className="text-lg font-semibold">{formatCompactNumber(extended.linesDeleted)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Claude Code sessions</div>
              <div className="text-lg font-semibold">{formatCompactNumber(extended.sessions)}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-blue-300/40 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        Claude Enterprise usage is covered by the seat contract — there&apos;s no per-message billing. Data has a
        3-day lag from the Analytics API.
      </div>
    </div>
  );
}
