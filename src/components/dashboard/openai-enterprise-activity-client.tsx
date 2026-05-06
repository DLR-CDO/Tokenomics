"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, MessageCircle, Layers, Cpu, Wrench, AlertTriangle, Coins } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { Disclosure } from "@/components/dashboard/disclosure";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatCredits as formatCreditsBase, formatUsd } from "@/lib/format";
import {
  computeEnterpriseCreditRates,
  formatCreditValuation,
  hasAnyCreditRate,
  valuateCredits,
} from "@/lib/enterprise-credits";
import { parsePythonDict } from "@/lib/parse-dict";

const formatCredits = (v: number): string => formatCreditsBase(v, { emptyDash: true });

type RankedModelRow = {
  model: string;
  requests: number;
  credits: number;
};

type EnterpriseUser = Record<string, string>;

type AllocationData = {
  configured: boolean;
  creditPoolConfigured?: boolean;
  overageRateConfigured?: boolean;
  monthlyAllocation?: number;
  monthlyCreditAllocation?: number;
  monthToDateCredits?: number;
  creditPercentUsed?: number;
  daysRemaining?: number;
  overageCredits?: number;
  overageCostUsd?: number;
  costPerOverageCreditUsd?: number;
};

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
  const [allocation, setAllocation] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [modelsRes, usersRes, allocRes] = await Promise.all([
          fetch(`/api/metrics/ranked?dimension=model&${fullQs}`, { cache: "no-store" }),
          fetch("/api/settings/enterprise-users", { cache: "no-store" }),
          fetch(`/api/metrics/monthly-allocation?source=${source}`, { cache: "no-store" }),
        ]);
        const modelsJson = await modelsRes.json();
        const usersJson = await usersRes.json();
        const allocJson = allocRes.ok ? await allocRes.json() : null;
        if (!cancelled) {
          setModels((modelsJson.data ?? []) as RankedModelRow[]);
          setUsers((usersJson.data ?? []) as EnterpriseUser[]);
          if (allocJson) setAllocation(allocJson as AllocationData);
        }
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs, source]);

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

  const creditRates = computeEnterpriseCreditRates({
    monthlyDollarAllocation: allocation?.monthlyAllocation,
    monthlyCreditAllocation: allocation?.monthlyCreditAllocation,
    costPerOverageCreditUsd: allocation?.costPerOverageCreditUsd,
  });
  const ratesAvailable = hasAnyCreditRate(creditRates);
  const totalCreditsValuationLine = ratesAvailable
    ? formatCreditValuation(valuateCredits(totalCredits, creditRates))
    : null;

  const kpis: KpiItem[] = [
    {
      label: "Total Credits",
      value: totalCredits > 0 ? formatCredits(totalCredits) : "0",
      icon: Sparkles,
      ...(totalCreditsValuationLine ? { hint: totalCreditsValuationLine } : {}),
    },
    { label: "Total Requests", value: formatCompactNumber(totalRequests), icon: MessageCircle },
    { label: "Usage Types", value: String(models.length), icon: Layers },
    { label: "Models Used", value: String(modelAdoption.length), icon: Cpu },
    { label: "Tools Used", value: String(toolUsage.length), icon: Wrench },
  ];

  if (allocation?.creditPoolConfigured && allocation.monthlyCreditAllocation) {
    const remaining = Math.max(
      0,
      (allocation.monthlyCreditAllocation ?? 0) - (allocation.monthToDateCredits ?? 0),
    );
    const pct = allocation.creditPercentUsed ?? 0;
    const remainingValuationLine = ratesAvailable
      ? formatCreditValuation(valuateCredits(remaining, creditRates))
      : null;
    const baseHint = `${pct.toFixed(1)}% used · ${allocation.daysRemaining ?? 0} days left in cycle`;
    kpis.push({
      label: "Credits Remaining",
      value: formatCredits(remaining),
      hint: remainingValuationLine ? `${baseHint} · ${remainingValuationLine}` : baseHint,
      icon: Coins,
      color: pct >= 100 ? "var(--color-destructive)" : pct >= 80 ? "var(--color-chart-3)" : undefined,
    });
  }

  if (allocation?.overageRateConfigured && (allocation.overageCostUsd ?? 0) > 0) {
    kpis.push({
      label: "Overage Cost (MTD)",
      value: formatUsd(allocation.overageCostUsd ?? 0),
      hint: `${formatCredits(allocation.overageCredits ?? 0)} over allowance @ ${formatUsd(allocation.costPerOverageCreditUsd ?? 0)}/credit`,
      icon: AlertTriangle,
      color: "var(--color-destructive)",
    });
  }

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
        if (!(v > 0)) return "—";
        const overage = creditRates.overageUsdPerCredit;
        if (overage === undefined) return formatCredits(v);
        return (
          <span>
            {formatCredits(v)}
            <span className="ml-1 text-xs text-muted-foreground">({formatUsd(v * overage)} at overage)</span>
          </span>
        );
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
