"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, GitCommit, GitPullRequest, Code2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";
import { Disclosure } from "@/components/dashboard/disclosure";
import type { TimeseriesRow, ModelRow } from "@/server/metrics";

type SummaryData = {
  requests: number;
};

type ExtendedTotals = {
  commits: number;
  pullRequests: number;
  linesAdded: number;
  linesDeleted: number;
  sessions: number;
};

const MODEL_COLUMNS: ColumnDef<ModelRow>[] = [
  { accessorKey: "model", header: "Model" },
  {
    accessorKey: "requests",
    header: "Requests",
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  {
    accessorKey: "tokensIn",
    header: "Tokens In",
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
  {
    accessorKey: "tokensOut",
    header: "Tokens Out",
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

export function ClaudeEnterpriseActivityClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "claude_enterprise";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [extended, setExtended] = useState<ExtendedTotals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sumRes, tsRes, modRes, extRes] = await Promise.all([
          fetch(`/api/metrics/summary?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/ranked?dimension=model&${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/claude-enterprise-totals?${fullQs}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();
        const modJson = await modRes.json();
        const extJson = extRes.ok ? await extRes.json() : null;

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries((tsJson.data ?? []) as TimeseriesRow[]);
          setModels((modJson.data ?? []) as ModelRow[]);
          if (extJson?.totals) setExtended(extJson.totals as ExtendedTotals);
        }
      } catch {
        /* empty */
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

  const kpis: KpiItem[] = [
    {
      label: "Messages",
      value: formatCompactNumber(summary.requests),
      icon: MessageCircle,
    },
  ];

  if (extended) {
    kpis.push(
      { label: "Commits", value: formatCompactNumber(extended.commits), icon: GitCommit },
      { label: "Pull Requests", value: formatCompactNumber(extended.pullRequests), icon: GitPullRequest },
      { label: "Sessions", value: formatCompactNumber(extended.sessions), icon: Code2 },
    );
  }

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Messages per Day"
          data={timeseries}
          series={[{ dataKey: "requests", name: "Messages", color: "var(--color-chart-2)", type: "area", yAxisId: "left" }]}
        />
        <TimeseriesChart
          title="Lines of Code per Day"
          data={timeseries}
          series={[
            { dataKey: "linesAdded", name: "Lines added", color: "var(--color-chart-1)", type: "area", yAxisId: "left" },
          ]}
        />
      </div>

      {models.length > 0 && (
        <Disclosure title="Model Mix" persistKey="cl-ent-models-open">
          <DataTable columns={MODEL_COLUMNS} data={models} />
        </Disclosure>
      )}
    </div>
  );
}
