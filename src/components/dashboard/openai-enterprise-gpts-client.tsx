"use client";

import { useEffect, useState, useMemo } from "react";
import { Bot, MessageCircle, ExternalLink, AlertTriangle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";

function formatMessages(v: number): string {
  return `${formatCompactNumber(v)} msgs`;
}

const STALE_DAYS = 60;

function isStale(g: GptRow): boolean {
  if (!g.isActive) return true;
  if (!g.lastDayActive) return true;
  const last = new Date(g.lastDayActive);
  if (isNaN(last.getTime())) return true;
  const daysAgo = (Date.now() - last.getTime()) / 86_400_000;
  return daysAgo > STALE_DAYS;
}

interface GptRow {
  gptName: string;
  configType: string;
  description: string;
  url: string;
  creatorEmail: string;
  isActive: boolean;
  firstDayActive: string;
  lastDayActive: string;
  messagesWorkspace: number;
  uniqueMessagers: number;
}

export function OpenAIEnterpriseGptsClient() {
  const [gpts, setGpts] = useState<GptRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/enterprise-gpts", { cache: "no-store" });
        const json = res.ok ? await res.json() : null;
        if (!cancelled && json?.gpts) setGpts(json.gpts as GptRow[]);
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const staleCount = useMemo(() => gpts.filter(isStale).length, [gpts]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const totalMessages = gpts.reduce((s, g) => s + g.messagesWorkspace, 0);
  const activeGpts = gpts.filter(g => g.isActive).length;

  const kpis: KpiItem[] = [
    { label: "Custom GPTs", value: String(gpts.length), icon: Bot },
    { label: "Active GPTs", value: String(activeGpts), icon: Bot, color: "var(--color-chart-1)" },
    { label: "Stale GPTs", value: String(staleCount), icon: AlertTriangle, color: "var(--color-chart-4)" },
    { label: "Total Messages", value: formatCompactNumber(totalMessages), icon: MessageCircle },
  ];

  const topGpts = [...gpts]
    .sort((a, b) => b.messagesWorkspace - a.messagesWorkspace)
    .slice(0, 10);
  const chartData = topGpts.map(g => ({ name: g.gptName, value: g.messagesWorkspace }));

  const GPT_COLUMNS: ColumnDef<GptRow, unknown>[] = [
    { accessorKey: "gptName", header: "GPT" },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ getValue }) => {
        const v = String(getValue() ?? "");
        if (!v) return <span className="text-muted-foreground">—</span>;
        return (
          <span title={v} className="block max-w-[200px] truncate">
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "url",
      header: "Link",
      cell: ({ getValue }) => {
        const v = String(getValue() ?? "");
        if (!v) return <span className="text-muted-foreground">—</span>;
        return (
          <a href={v} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        );
      },
    },
    { accessorKey: "configType", header: "Type" },
    { accessorKey: "creatorEmail", header: "Creator" },
    {
      accessorKey: "messagesWorkspace",
      header: "Messages",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "uniqueMessagers",
      header: "Users",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    { accessorKey: "firstDayActive", header: "First Active" },
    { accessorKey: "lastDayActive", header: "Last Active" },
    {
      accessorKey: "isActive",
      header: "Active",
      cell: ({ getValue }) => getValue() ? "Yes" : "No",
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      {chartData.length > 0 && (
        <HorizontalBarChart title="Top GPTs by Messages" data={chartData} formatValue={formatMessages} />
      )}

      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold tracking-tight">All Custom GPTs</h3>
        <DataTable columns={GPT_COLUMNS} data={gpts} />
      </div>
    </div>
  );
}
