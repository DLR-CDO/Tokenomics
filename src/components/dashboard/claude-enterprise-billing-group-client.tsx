"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";

type GroupRow = {
  name: string;
  value: number;
  uniqueUsers: number;
};

export interface ClaudeEnterpriseBillingGroupClientProps {
  title: string;
  description: string;
  columnHeader: string;
  metricHeader: string;
  mode: "chat_project" | "skill" | "connector";
}

/**
 * Displays the rollup for `billing_group_name` on `claude_enterprise` usage facts
 * filtered by `mode` — used for chat projects, skills, and connectors tabs.
 * Queries `/api/metrics/claude-enterprise-groups?mode=…`.
 */
export function ClaudeEnterpriseBillingGroupClient({
  title,
  description,
  columnHeader,
  metricHeader,
  mode,
}: ClaudeEnterpriseBillingGroupClientProps) {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams(qs);
        params.set("mode", mode);
        const res = await fetch(`/api/metrics/claude-enterprise-groups?${params.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load groups");
        if (!cancelled) setRows((json.groups as GroupRow[]) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs, mode]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const kpis: KpiItem[] = [{ label: "Total entries", value: String(rows.length) }];

  const columns: ColumnDef<GroupRow>[] = [
    { accessorKey: "name", header: columnHeader },
    {
      accessorKey: "value",
      header: metricHeader,
      cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
    },
    {
      accessorKey: "uniqueUsers",
      header: "Unique users",
      cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
    },
  ];

  const chartData = rows.slice(0, 15).map((r) => ({ name: r.name, value: r.value }));

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <KpiGrid items={kpis} />

      {chartData.length > 0 && (
        <HorizontalBarChart title={title} data={chartData} formatValue={formatCompactNumber} />
      )}

      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <DataTable columns={columns} data={rows} />
      </div>
    </div>
  );
}
