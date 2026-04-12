"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, MessageCircle, Layers, Cpu, Wrench } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { Disclosure } from "@/components/dashboard/disclosure";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";
import { parsePythonDict } from "@/lib/parse-dict";

type RankedModelRow = {
  model: string;
  requests: number;
  credits: number;
};

type EnterpriseUser = Record<string, string>;

function formatCredits(v: number): string {
  if (v === 0) return "—";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M cr`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K cr`;
  return `${v.toFixed(1)} cr`;
}

function aggregateDict(users: EnterpriseUser[], field: string): { name: string; value: number }[] {
  const totals: Record<string, number> = {};
  for (const u of users) {
    const dict = parsePythonDict(u[field] ?? "");
    for (const [k, v] of Object.entries(dict)) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function OpenAIEnterpriseActivityClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "openai_enterprise";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [models, setModels] = useState<RankedModelRow[]>([]);
  const [users, setUsers] = useState<EnterpriseUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [modelsRes, usersRes] = await Promise.all([
          fetch(`/api/metrics/ranked?dimension=model&${fullQs}`, { cache: "no-store" }),
          fetch("/api/settings/enterprise-users", { cache: "no-store" }),
        ]);
        const modelsJson = await modelsRes.json();
        const usersJson = await usersRes.json();
        if (!cancelled) {
          setModels((modelsJson.data ?? []) as RankedModelRow[]);
          setUsers((usersJson.data ?? []) as EnterpriseUser[]);
        }
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs]);

  const modelAdoption = useMemo(() => aggregateDict(users, "modelToMessages"), [users]);
  const toolUsage = useMemo(() => aggregateDict(users, "toolToMessages"), [users]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const totalCredits = models.reduce((s, m) => s + (m.credits ?? 0), 0);
  const totalRequests = models.reduce((s, m) => s + (m.requests ?? 0), 0);

  const kpis: KpiItem[] = [
    { label: "Total Credits", value: totalCredits > 0 ? formatCredits(totalCredits) : "0", icon: Sparkles },
    { label: "Total Requests", value: formatCompactNumber(totalRequests), icon: MessageCircle },
    { label: "Usage Types", value: String(models.length), icon: Layers },
    { label: "Models Used", value: String(modelAdoption.length), icon: Cpu },
    { label: "Tools Used", value: String(toolUsage.length), icon: Wrench },
  ];

  const topModels = models.slice(0, 10);
  const chartData = topModels.map(m => ({
    name: formatUsageType(m.model),
    value: m.requests,
  }));

  const MODEL_COLUMNS: ColumnDef<RankedModelRow, unknown>[] = [
    {
      accessorKey: "model",
      header: "Usage Type",
      cell: ({ getValue }) => formatUsageType(String(getValue())),
    },
    {
      accessorKey: "requests",
      header: "Requests",
      cell: ({ getValue }) => formatCompactNumber(Number(getValue())),
    },
    {
      accessorKey: "credits",
      header: "Credits",
      cell: ({ getValue }) => {
        const v = Number(getValue());
        return v > 0 ? formatCredits(v) : "—";
      },
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="grid gap-6 lg:grid-cols-2">
        {chartData.length > 0 && (
          <HorizontalBarChart title="Top Usage Types (by Requests)" data={chartData} formatValue={formatCompactNumber} />
        )}
      </div>

      {(modelAdoption.length > 0 || toolUsage.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {modelAdoption.length > 0 && (
            <HorizontalBarChart
              title="Model Adoption (Messages)"
              data={modelAdoption.slice(0, 15)}
              formatValue={formatCompactNumber}
            />
          )}
          {toolUsage.length > 0 && (
            <HorizontalBarChart
              title="Tool Usage (Messages)"
              data={toolUsage.slice(0, 15)}
              formatValue={formatCompactNumber}
            />
          )}
        </div>
      )}

      <Disclosure title="All Usage Types" persistKey="oe-models-open">
        <DataTable columns={MODEL_COLUMNS} data={models} />
      </Disclosure>
    </div>
  );
}

function formatUsageType(raw: string): string {
  return raw
    .replace(/^chat\.completion\.\d+\./, "")
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
