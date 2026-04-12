"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, Monitor, Cloud, Bug, GitCommitHorizontal } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { StackedTimeseriesChart, type StackedSeriesConfig } from "@/components/dashboard/stacked-timeseries-chart";
import { TrendBadge, computeTrend } from "./trend-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactNumber } from "@/lib/format";
import type { DauBreakdownRow, ClientVersionRow, AiCommitRow } from "@/server/metrics";

type AdoptionData = {
  dauBreakdown: DauBreakdownRow[];
  clientVersions: ClientVersionRow[];
  aiCommits: AiCommitRow[];
};

const DAU_KEYS: StackedSeriesConfig[] = [
  { dataKey: "cliDau", name: "CLI", color: "var(--color-chart-1)" },
  { dataKey: "cloudAgentDau", name: "Cloud Agent", color: "var(--color-chart-2)" },
  { dataKey: "bugbotDau", name: "Bugbot", color: "var(--color-chart-4)" },
];

export function AdoptionClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [data, setData] = useState<AdoptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/metrics/adoption?source=cursor&${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load adoption data");
        if (!cancelled) setData(json as AdoptionData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  const kpis = useMemo<KpiItem[]>(() => {
    if (!data) return [];
    const dau = data.dauBreakdown;
    const avgDau = dau.length > 0 ? dau.reduce((s, r) => s + r.totalDau, 0) / dau.length : 0;
    const avgCli = dau.length > 0 ? dau.reduce((s, r) => s + r.cliDau, 0) / dau.length : 0;
    const avgCloud = dau.length > 0 ? dau.reduce((s, r) => s + r.cloudAgentDau, 0) / dau.length : 0;
    const avgBugbot = dau.length > 0 ? dau.reduce((s, r) => s + r.bugbotDau, 0) / dau.length : 0;

    const dauTrend = computeTrend(dau.map((r) => r.totalDau));
    const cliTrend = computeTrend(dau.map((r) => r.cliDau));
    const cloudTrend = computeTrend(dau.map((r) => r.cloudAgentDau));
    const bugbotTrend = computeTrend(dau.map((r) => r.bugbotDau));

    return [
      { 
        label: "Avg DAU", 
        value: formatCompactNumber(avgDau), 
        icon: Activity, 
        color: "var(--color-chart-1)", 
        hint: "Average daily active users across all surfaces.",
        trend: dauTrend.changePct,
      },
      { 
        label: "CLI DAU", 
        value: `${formatCompactNumber(avgCli)} (${avgDau > 0 ? ((avgCli / avgDau) * 100).toFixed(0) : 0}%)`, 
        icon: Monitor, 
        color: "var(--color-chart-2)", 
        hint: "Users of the Cursor CLI/desktop app.",
        trend: cliTrend.changePct,
      },
      { 
        label: "Cloud Agent DAU", 
        value: formatCompactNumber(avgCloud), 
        icon: Cloud, 
        color: "var(--color-chart-3)", 
        hint: "Users of the cloud-based agent.",
        trend: cloudTrend.changePct,
      },
      { 
        label: "Bugbot DAU", 
        value: formatCompactNumber(avgBugbot), 
        icon: Bug, 
        color: "var(--color-chart-4)", 
        hint: "Users of the Bugbot feature.",
        trend: bugbotTrend.changePct,
      },
    ];
  }, [data]);

  const commitTotals = useMemo(() => {
    if (!data) return { commits: 0, linesAdded: 0, linesDeleted: 0 };
    return data.aiCommits.reduce(
      (acc, r) => ({
        commits: acc.commits + r.commits,
        linesAdded: acc.linesAdded + r.linesAdded,
        linesDeleted: acc.linesDeleted + r.linesDeleted,
      }),
      { commits: 0, linesAdded: 0, linesDeleted: 0 },
    );
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Could not load adoption data</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const dauChartData = data.dauBreakdown.map((r) => ({
    date: r.date,
    cliDau: r.cliDau,
    cloudAgentDau: r.cloudAgentDau,
    bugbotDau: r.bugbotDau,
  }));

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <StackedTimeseriesChart
        title="DAU by Surface"
        description="Daily active users broken down by CLI, Cloud Agent, and Bugbot."
        data={dauChartData}
        keys={DAU_KEYS}
      />

      {data.clientVersions.length > 0 && (
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">Client Versions</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">% of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.clientVersions.map((v) => (
                <TableRow key={v.version}>
                  <TableCell className="font-mono text-sm">{v.version}</TableCell>
                  <TableCell className="text-right">{formatCompactNumber(v.userCount)}</TableCell>
                  <TableCell className="text-right">{v.percentage.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data.aiCommits.length > 0 && (
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">AI Code Commits</h3>
            <p className="text-xs text-muted-foreground">Commits made with AI-generated code, grouped by repository.</p>
          </div>

          <div className="mb-4 flex flex-wrap gap-4">
            <KpiPill icon={GitCommitHorizontal} label="Commits" value={formatCompactNumber(commitTotals.commits)} />
            <KpiPill label="Lines +" value={formatCompactNumber(commitTotals.linesAdded)} color="text-green-600" />
            <KpiPill label="Lines −" value={formatCompactNumber(commitTotals.linesDeleted)} color="text-red-500" />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">Lines +</TableHead>
                <TableHead className="text-right">Lines −</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.aiCommits.map((r) => (
                <TableRow key={r.repo}>
                  <TableCell className="font-mono text-sm">{r.repo}</TableCell>
                  <TableCell className="text-right">{formatCompactNumber(r.commits)}</TableCell>
                  <TableCell className="text-right">{formatCompactNumber(r.linesAdded)}</TableCell>
                  <TableCell className="text-right">{formatCompactNumber(r.linesDeleted)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function KpiPill({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-surface-container px-3 py-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${color ?? ""}`}>{value}</span>
    </div>
  );
}
