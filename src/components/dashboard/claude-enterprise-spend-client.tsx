"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Coins, DollarSign, Trophy, Cpu, Layers, Flame, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { StackedTimeseriesChart, type StackedSeriesConfig } from "@/components/dashboard/stacked-timeseries-chart";
import { ClaudeRebillChart } from "@/components/dashboard/claude-rebill-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format";

type SpendKpis = {
  totalUsd: number;
  listTotalUsd: number;
  latestBucketDate: string | null;
  invoicingGradeAsOf: string;
  topUser: { id: string | null; email: string | null; name: string | null; usd: number } | null;
  topProduct: { product: string; usd: number } | null;
  topModel: { model: string; usd: number } | null;
};

type DailyByProduct = {
  date: string;
  byProduct: Record<string, number>;
  total: number;
};

type SpendUserRow = {
  memberId: string;
  email: string | null;
  name: string | null;
  totalUsd: number;
  listTotalUsd: number;
  byProduct: Record<string, number>;
};

type SpendModelRow = {
  model: string;
  totalUsd: number;
  listTotalUsd: number;
};

type SpendResponse = {
  range: { from: string; to: string };
  kpis: SpendKpis;
  daily: DailyByProduct[];
  topUsers: SpendUserRow[];
  topModels: SpendModelRow[];
};

type BurnForecast = {
  policy: { reloadAmountUsd: number; startedOn: string | null };
  trailing30Burn: number;
  trailing30MonthlyEquivalent: number;
  cumulativeSinceCycleStart: { date: string; daily: number; cumulative: number }[];
  rebillMarkers: { date: string; rebillNumber: number }[];
};

const PRODUCT_LABELS: Record<string, string> = {
  chat: "Chat",
  claude_code: "Claude Code",
  cowork: "Cowork",
  office_agent: "Office Agent",
  claude_in_chrome: "Chrome",
  claude_design: "Design",
  unknown: "Unknown",
};

const PRODUCT_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "#9ca3af",
];

function productLabel(p: string): string {
  return PRODUCT_LABELS[p] ?? p;
}

export function ClaudeEnterpriseSpendClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [data, setData] = useState<SpendResponse | null>(null);
  const [burn, setBurn] = useState<BurnForecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [spendRes, burnRes] = await Promise.all([
          fetch(`/api/metrics/claude-enterprise-spend?${qs}`, { cache: "no-store" }),
          fetch("/api/metrics/claude-enterprise-burn", { cache: "no-store" }),
        ]);
        if (spendRes.ok) {
          const json = (await spendRes.json()) as SpendResponse;
          if (!cancelled) setData(json);
        }
        if (burnRes.ok) {
          const json = (await burnRes.json()) as BurnForecast;
          if (!cancelled) setBurn(json);
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
  }, [qs]);

  const productKeys = useMemo<StackedSeriesConfig[]>(() => {
    if (!data) return [];
    const seen = new Set<string>();
    for (const d of data.daily) for (const k of Object.keys(d.byProduct)) seen.add(k);
    return Array.from(seen)
      .sort()
      .map((p, i) => ({ dataKey: p, name: productLabel(p), color: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }));
  }, [data]);

  const dailyChartData = useMemo(() => {
    if (!data) return [];
    return data.daily.map((d) => ({ date: d.date, ...d.byProduct }));
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        No spend data available yet. Run the Claude Enterprise sync once the cost+usage endpoints are enabled and
        confirmed via Settings → Claude Enterprise → Cost &amp; usage API recon.
      </div>
    );
  }

  const kpis: KpiItem[] = [
    {
      label: "Extras spend (window)",
      value: formatUsd(data.kpis.totalUsd),
      hint: data.kpis.latestBucketDate ? `Latest data: ${data.kpis.latestBucketDate}` : undefined,
      icon: DollarSign,
    },
    {
      label: "List-price spend",
      value: formatUsd(data.kpis.listTotalUsd),
      hint:
        data.kpis.listTotalUsd > 0 && data.kpis.totalUsd > 0
          ? `Discount: ${(((data.kpis.listTotalUsd - data.kpis.totalUsd) / data.kpis.listTotalUsd) * 100).toFixed(1)}%`
          : undefined,
      icon: Coins,
    },
  ];

  if (burn) {
    kpis.push({
      label: "Extras burn (cycle)",
      value: formatUsd(
        burn.cumulativeSinceCycleStart.length > 0
          ? burn.cumulativeSinceCycleStart[burn.cumulativeSinceCycleStart.length - 1].cumulative
          : 0,
      ),
      hint: burn.policy.startedOn
        ? `Since ${burn.policy.startedOn}`
        : "Last 90 days (no policy start set)",
      icon: Flame,
    });
    kpis.push({
      label: "Rebills triggered (cycle)",
      value: String(burn.rebillMarkers.length),
      hint: `Each rebill: ${formatUsd(burn.policy.reloadAmountUsd)}`,
      icon: RotateCcw,
    });
  }

  kpis.push(
    {
      label: "Top user",
      value: data.kpis.topUser
        ? `${formatUsd(data.kpis.topUser.usd)}`
        : "—",
      hint: data.kpis.topUser?.email ?? data.kpis.topUser?.name ?? undefined,
      icon: Trophy,
    },
    {
      label: "Top product",
      value: data.kpis.topProduct ? formatUsd(data.kpis.topProduct.usd) : "—",
      hint: data.kpis.topProduct ? productLabel(data.kpis.topProduct.product) : undefined,
      icon: Layers,
    },
    {
      label: "Top model",
      value: data.kpis.topModel ? formatUsd(data.kpis.topModel.usd) : "—",
      hint: data.kpis.topModel?.model ?? undefined,
      icon: Cpu,
    },
  );

  const userColumns: ColumnDef<SpendUserRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "User",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name ?? row.original.email ?? row.original.memberId}</div>
          {row.original.email && row.original.name ? (
            <div className="text-xs text-muted-foreground">{row.original.email}</div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "totalUsd",
      header: "Spend",
      cell: ({ getValue }) => formatUsd(Number(getValue())),
    },
    {
      accessorKey: "listTotalUsd",
      header: "List price",
      cell: ({ getValue }) => formatUsd(Number(getValue())),
    },
  ];

  const modelColumns: ColumnDef<SpendModelRow, unknown>[] = [
    { accessorKey: "model", header: "Model" },
    {
      accessorKey: "totalUsd",
      header: "Spend",
      cell: ({ getValue }) => formatUsd(Number(getValue())),
    },
    {
      accessorKey: "listTotalUsd",
      header: "List price",
      cell: ({ getValue }) => formatUsd(Number(getValue())),
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="rounded-lg border border-blue-300/40 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        The Anthropic Analytics API reports Prepaid Extra Usage <em>consumption</em>, not the rebill events
        themselves. Rebill markers in the chart below are derived from the cumulative-burn curve crossing the
        configured auto-reload amount. Anthropic revises cost data for up to 30 days; days more recent than{" "}
        <strong>{data.kpis.invoicingGradeAsOf}</strong> may still change.
      </div>

      {burn && burn.cumulativeSinceCycleStart.length > 0 ? (
        <ClaudeRebillChart
          title="Cumulative extras since last rebill"
          description={`Markers reset the cumulative each time it crosses ${formatUsd(burn.policy.reloadAmountUsd)}. ${burn.rebillMarkers.length} rebill${burn.rebillMarkers.length === 1 ? "" : "s"} in window.`}
          cumulative={burn.cumulativeSinceCycleStart}
          rebillMarkers={burn.rebillMarkers}
          reloadAmountUsd={burn.policy.reloadAmountUsd}
          syncId="cl-spend-rebill"
        />
      ) : null}

      {dailyChartData.length > 0 && productKeys.length > 0 ? (
        <StackedTimeseriesChart
          title="Daily spend by product"
          description={`Window: ${data.range.from} → ${data.range.to}`}
          data={dailyChartData}
          keys={productKeys}
          height={320}
          syncId="cl-spend"
        />
      ) : (
        <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground shadow-sm">
          No daily spend buckets in this window.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">Top users by spend</h3>
          {data.topUsers.length > 0 ? (
            <DataTable columns={userColumns} data={data.topUsers} />
          ) : (
            <div className="text-sm text-muted-foreground">No per-user spend in this window.</div>
          )}
        </div>
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">Top models by spend</h3>
          {data.topModels.length > 0 ? (
            <DataTable columns={modelColumns} data={data.topModels} />
          ) : (
            <div className="text-sm text-muted-foreground">No per-model spend in this window.</div>
          )}
        </div>
      </div>
    </div>
  );
}
