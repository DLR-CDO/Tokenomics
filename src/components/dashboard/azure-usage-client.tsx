"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Hash, Download, Upload, Activity, DollarSign, Layers } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { computeTrend } from "@/components/dashboard/trend-badge";
import { Disclosure } from "@/components/dashboard/disclosure";
import type { TimeseriesRow } from "@/server/metrics";

type SummaryData = {
  tokens: number;
  requests: number;
  windowSpendUsd: number;
};

type BreakdownRow = {
  app: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  requests: number;
  costUsd: number;
};

type Dimensions = {
  apps: string[];
  models: string[];
};

const ALL = "__all__";

export function AzureUsageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selectedApp = searchParams.get("billingGroup") ?? ALL;
  const selectedModel = searchParams.get("model") ?? ALL;

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === ALL) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const source = "azure";
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [dimensions, setDimensions] = useState<Dimensions>({ apps: [], models: [] });
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dimRes = await fetch(`/api/metrics/azure-dimensions?${fullQs}`, { cache: "no-store" });
        const dimJson = await dimRes.json();
        if (!cancelled) setDimensions(dimJson as Dimensions);
      } catch {
        /* dimensions are non-critical */
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sumRes, tsRes, bkRes] = await Promise.all([
          fetch(`/api/metrics/summary?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/timeseries?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/azure-breakdown?${fullQs}`, { cache: "no-store" }),
        ]);
        const sumJson = await sumRes.json();
        const tsJson = await tsRes.json();
        const bkJson = await bkRes.json();

        if (!sumRes.ok) throw new Error(sumJson.error ?? "Failed to load summary");

        if (!cancelled) {
          setSummary(sumJson as SummaryData);
          setTimeseries((tsJson.data ?? []) as TimeseriesRow[]);
          setBreakdown((bkJson.data ?? []) as BreakdownRow[]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs]);

  const totals = useMemo(() => {
    const t = { tokensIn: 0, tokensOut: 0, requests: 0, costUsd: 0 };
    for (const r of breakdown) {
      t.tokensIn += r.tokensIn;
      t.tokensOut += r.tokensOut;
      t.requests += r.requests;
      t.costUsd += r.costUsd;
    }
    return t;
  }, [breakdown]);

  const tokensInTrend = computeTrend(timeseries.map((r) => r.tokensIn));
  const tokensOutTrend = computeTrend(timeseries.map((r) => r.tokensOut));

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Azure Usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  const kpis: KpiItem[] = [
    {
      label: "Total Tokens",
      value: formatCompactNumber(totals.tokensIn + totals.tokensOut),
      icon: Hash,
    },
    {
      label: "Tokens In",
      value: formatCompactNumber(totals.tokensIn),
      icon: Download,
      trend: tokensInTrend.changePct,
    },
    {
      label: "Tokens Out",
      value: formatCompactNumber(totals.tokensOut),
      icon: Upload,
      trend: tokensOutTrend.changePct,
    },
    {
      label: "Requests",
      value: formatCompactNumber(totals.requests),
      icon: Activity,
    },
  ];

  if (summary.windowSpendUsd > 0) {
    kpis.push({
      label: "Cost",
      value: formatUsd(summary.windowSpendUsd),
      icon: DollarSign,
    });
  }

  const barByModel = [...breakdown]
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.model] = (acc[r.model] ?? 0) + r.tokensIn + r.tokensOut;
      return acc;
    }, {});
  const modelChartData = Object.entries(barByModel)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const barByApp = [...breakdown]
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.app] = (acc[r.app] ?? 0) + r.tokensIn + r.tokensOut;
      return acc;
    }, {});
  const appChartData = Object.entries(barByApp)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const COLUMNS: ColumnDef<BreakdownRow, unknown>[] = [
    { accessorKey: "app", header: "App" },
    { accessorKey: "model", header: "Model" },
    {
      id: "totalTokens",
      header: "Total Tokens",
      accessorFn: (row) => row.tokensIn + row.tokensOut,
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensIn",
      header: "Tokens In",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensOut",
      header: "Tokens Out",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "requests",
      header: "Requests",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
  ];

  const hasAppFilter = selectedApp !== ALL;
  const hasModelFilter = selectedModel !== ALL;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-container px-5 py-3">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Filter</span>

        <Select value={selectedApp} onValueChange={(v) => setFilter("billingGroup", v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Apps" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Apps</SelectItem>
            {dimensions.apps.map((app) => (
              <SelectItem key={app} value={app}>{app}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedModel} onValueChange={(v) => setFilter("model", v)}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="All Models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Models</SelectItem>
            {dimensions.models.map((model) => (
              <SelectItem key={model} value={model}>{model}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(hasAppFilter || hasModelFilter) && (
          <button
            className="text-xs text-muted-foreground underline hover:text-foreground"
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.delete("billingGroup");
              params.delete("model");
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <KpiGrid items={kpis} />

      <TimeseriesChart
        title="Daily Tokens (In vs Out)"
        data={timeseries}
        series={[
          { dataKey: "tokensIn", name: "Tokens In", color: "var(--color-chart-1)", type: "area", yAxisId: "left" },
          { dataKey: "tokensOut", name: "Tokens Out", color: "var(--color-chart-2)", type: "area", yAxisId: "left" },
        ]}
        syncId="azure-usage"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {!hasModelFilter && modelChartData.length > 0 && (
          <HorizontalBarChart
            title="Tokens by Model"
            data={modelChartData}
            formatValue={formatCompactNumber}
          />
        )}
        {!hasAppFilter && appChartData.length > 0 && (
          <HorizontalBarChart
            title="Tokens by App"
            data={appChartData}
            formatValue={formatCompactNumber}
          />
        )}
      </div>

      <Disclosure title="Usage Breakdown" defaultOpen persistKey="azure-usage-breakdown">
        <DataTable columns={COLUMNS} data={breakdown} />
      </Disclosure>
    </div>
  );
}
