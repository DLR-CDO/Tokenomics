"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Database, ArrowDown, ArrowUp, Zap, Globe, Layers } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { TimeseriesChart } from "@/components/dashboard/timeseries-chart";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatUsd } from "@/lib/format";

type TokenKpis = {
  totalTokens: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheRead: number;
  totalCacheCreate: number;
  totalUncachedInput: number;
  cacheHitRate: number | null;
  webSearchRequests: number;
};

type DailyTokenRow = {
  date: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
};

type TokenUserRow = {
  memberId: string;
  email: string | null;
  name: string | null;
  totalTokens: number;
  tokensIn: number;
  tokensOut: number;
  extrasUsd: number;
  byProduct: Record<string, number>;
};

type TokenProductRow = {
  product: string;
  totalTokens: number;
  tokensIn: number;
  tokensOut: number;
};

type TokensResponse = {
  range: { from: string; to: string };
  kpis: TokenKpis;
  daily: DailyTokenRow[];
  topUsers: TokenUserRow[];
  byProduct: TokenProductRow[];
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

function productLabel(p: string): string {
  return PRODUCT_LABELS[p] ?? p;
}

export function ClaudeEnterpriseTokensClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [data, setData] = useState<TokensResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/metrics/claude-enterprise-tokens?${qs}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as TokensResponse;
          if (!cancelled) setData(json);
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

  const productChart = useMemo(() => {
    if (!data) return [];
    return data.byProduct.map((p) => ({ name: productLabel(p.product), value: p.totalTokens }));
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
        No token data available yet. Run the Claude Enterprise sync once the cost+usage endpoints are enabled.
      </div>
    );
  }

  const kpis: KpiItem[] = [
    { label: "Total tokens", value: formatCompactNumber(data.kpis.totalTokens), icon: Database },
    { label: "Tokens in", value: formatCompactNumber(data.kpis.totalTokensIn), icon: ArrowDown },
    { label: "Tokens out", value: formatCompactNumber(data.kpis.totalTokensOut), icon: ArrowUp },
    {
      label: "Cache hit rate",
      value: data.kpis.cacheHitRate != null ? `${(data.kpis.cacheHitRate * 100).toFixed(1)}%` : "—",
      hint:
        data.kpis.totalCacheRead > 0
          ? `${formatCompactNumber(data.kpis.totalCacheRead)} cached / ${formatCompactNumber(
              data.kpis.totalCacheRead + data.kpis.totalUncachedInput + data.kpis.totalCacheCreate,
            )} input`
          : undefined,
      icon: Zap,
    },
    {
      label: "Web search calls",
      value: formatCompactNumber(data.kpis.webSearchRequests),
      icon: Globe,
    },
    {
      label: "Active products",
      value: String(data.byProduct.length),
      icon: Layers,
    },
  ];

  const userColumns: ColumnDef<TokenUserRow, unknown>[] = [
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
      accessorKey: "totalTokens",
      header: "Total tokens",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensIn",
      header: "In",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensOut",
      header: "Out",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "extrasUsd",
      header: "Extras $",
      cell: ({ getValue }) => {
        const v = Number(getValue() ?? 0);
        return v > 0 ? formatUsd(v) : "—";
      },
    },
  ];

  const productColumns: ColumnDef<TokenProductRow, unknown>[] = [
    {
      accessorKey: "product",
      header: "Product",
      cell: ({ getValue }) => productLabel(String(getValue())),
    },
    {
      accessorKey: "totalTokens",
      header: "Total tokens",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensIn",
      header: "In",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "tokensOut",
      header: "Out",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TimeseriesChart
          title="Daily token volume"
          data={data.daily}
          series={[
            { dataKey: "tokensIn", name: "Input", color: "var(--color-chart-1)", type: "area", yAxisId: "left" },
            { dataKey: "tokensOut", name: "Output", color: "var(--color-chart-2)", type: "area", yAxisId: "left" },
          ]}
          syncId="cl-tokens"
        />
        <TimeseriesChart
          title="Daily cache breakdown"
          data={data.daily}
          series={[
            { dataKey: "cacheRead", name: "Cache read", color: "var(--color-chart-3)", type: "area", yAxisId: "left" },
            { dataKey: "cacheCreate", name: "Cache create", color: "var(--color-chart-4)", type: "area", yAxisId: "left" },
          ]}
          syncId="cl-tokens"
        />
      </div>

      {productChart.length > 0 ? (
        <HorizontalBarChart title="Tokens by product" data={productChart} formatValue={formatCompactNumber} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">Top users by tokens</h3>
          {data.topUsers.length > 0 ? (
            <DataTable columns={userColumns} data={data.topUsers} />
          ) : (
            <div className="text-sm text-muted-foreground">No per-user token data in this window.</div>
          )}
        </div>
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">By product</h3>
          {data.byProduct.length > 0 ? (
            <DataTable columns={productColumns} data={data.byProduct} />
          ) : (
            <div className="text-sm text-muted-foreground">No product breakdown in this window.</div>
          )}
        </div>
      </div>
    </div>
  );
}
