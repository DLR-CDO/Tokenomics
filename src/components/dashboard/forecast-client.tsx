"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ForecastChart } from "@/components/dashboard/forecast-chart";
import { SAFETY_MARGIN_CHANGED_EVENT } from "@/components/dashboard/safety-margin-editor";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContractRecommendation, ForecastResult } from "@/lib/forecast";
import { formatUsd } from "@/lib/format";

type GlobalSummary = {
  ytdSpend: number;
  projectedTotal: number;
  recommendedAnnual: number;
  safetyMargin: number;
  safetyMarginPct: number;
  perApp: { source: string; label: string; primaryUsd: number; projectedUsd: number }[];
};

type ForecastSettingsPayload = { safetyMarginPct: number };

type ForecastPayload = {
  cycle: { cycleStart: string; cycleEnd: string; label: string | null } | null;
  forecast: ForecastResult;
  recommendation: ContractRecommendation;
  forecastSettings?: ForecastSettingsPayload;
  globalSummary?: GlobalSummary;
};

type BudgetData = {
  configured: boolean;
  budget?: { amount: number; endDate: string };
  metrics?: { remaining: number; daysRemainingInContract: number; dailyBurnRate: number };
};

type AllocationData = {
  configured: boolean;
  creditPoolConfigured?: boolean;
  overageRateConfigured?: boolean;
  monthlyCreditAllocation?: number;
  monthToDateCredits?: number;
  projectedCreditMonthEnd?: number;
  costPerOverageCreditUsd?: number;
  overageCredits?: number;
  overageCostUsd?: number;
  projectedOverageCredits?: number;
  projectedOverageCostUsd?: number;
  billingStart?: string;
  billingEnd?: string;
};

function formatCredits(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M cr`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K cr`;
  return `${v.toFixed(0)} cr`;
}

export function ForecastClient({ source = "cursor" }: { source?: string }) {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [payload, setPayload] = useState<ForecastPayload | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [allocation, setAllocation] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marginRefresh, setMarginRefresh] = useState(0);

  // Refetch when the safety margin editor (now in GlobalFilters) saves a new value.
  useEffect(() => {
    const onChange = () => setMarginRefresh((n) => n + 1);
    window.addEventListener(SAFETY_MARGIN_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SAFETY_MARGIN_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const requests: Promise<Response>[] = [
          fetch(`/api/metrics/forecast?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/budget?source=${source}`, { cache: "no-store" }),
        ];
        if (source === "openai_enterprise") {
          requests.push(fetch(`/api/metrics/monthly-allocation?source=${source}`, { cache: "no-store" }));
        }
        const [fRes, bRes, allocRes] = await Promise.all(requests);
        const fJson = await fRes.json();
        const bJson = await bRes.json();
        const allocJson = allocRes && allocRes.ok ? await allocRes.json() : null;
        if (!fRes.ok) throw new Error(fJson.error ?? "Failed to load forecast");
        if (!cancelled) {
          setPayload(fJson as ForecastPayload);
          setBudgetData(bJson as BudgetData);
          if (allocJson) setAllocation(allocJson as AllocationData);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs, fullQs, source, marginRefresh]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-[360px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Forecast</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const result = payload?.forecast;
  const rec = payload?.recommendation;
  const globalSummary = payload?.globalSummary;
  if (!result) return null;

  const budgetDailyPace = budgetData?.configured && budgetData.metrics
    ? budgetData.metrics.remaining / Math.max(1, budgetData.metrics.daysRemainingInContract)
    : null;

  const safetyMarginPct =
    payload?.forecastSettings?.safetyMarginPct ??
    globalSummary?.safetyMarginPct ??
    (globalSummary && globalSummary.safetyMargin > 0
      ? Math.round((globalSummary.safetyMargin - 1) * 100)
      : 15);

  return (
    <div className="space-y-6">
      {/* Hero recommendation */}
      {globalSummary && globalSummary.projectedTotal > 0 ? (
        <div className="rounded-2xl bg-surface-tonal px-6 py-6 sm:px-8">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Recommended annual contract (through 12/31)</p>
            <p className="text-3xl font-bold tracking-tight sm:text-4xl">
              {formatUsd(globalSummary.recommendedAnnual)}
            </p>
            <p className="text-sm text-muted-foreground">
              Projected {formatUsd(globalSummary.projectedTotal)} across {globalSummary.perApp.length} apps at current pace, plus a {safetyMarginPct}% safety margin. {formatUsd(globalSummary.ytdSpend)} already spent year-to-date.
            </p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {globalSummary.perApp.map((a) => (
              <div key={a.source} className="flex flex-col gap-0.5 rounded-xl bg-card px-3 py-2 shadow-sm">
                <span className="text-xs font-medium text-muted-foreground">{a.label}</span>
                <span className="text-base font-semibold tracking-tight">{formatUsd(a.projectedUsd)}</span>
                <span className="text-xs text-muted-foreground">{formatUsd(a.primaryUsd)} YTD</span>
              </div>
            ))}
          </div>
        </div>
      ) : rec && rec.recommendedAmount > 0 ? (
        <div className="rounded-2xl bg-surface-tonal px-6 py-6 sm:px-8">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Recommended next contract (through 12/31)</p>
            <p className="text-3xl font-bold tracking-tight sm:text-4xl">
              {formatUsd(rec.recommendedAmount)}
            </p>
            <p className="text-sm text-muted-foreground">
              Based on {formatUsd(rec.dailyBurnRate)}/day burn rate (trailing 30 days) over {rec.daysRemaining} remaining days, plus a {safetyMarginPct}% safety margin.
            </p>
          </div>
        </div>
      ) : null}

      {/* Scenario cards */}
      {rec && rec.scenarios.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h3 className="text-sm font-semibold">Forecasted pace</h3>
            <p className="text-xs text-muted-foreground">
              Annualized projections at current burn vs. ±10% sensitivity (no safety margin applied).
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {rec.scenarios.map((s) => (
              <div
                key={s.label}
                className="flex flex-col gap-1 rounded-2xl bg-surface-container px-5 py-4"
              >
                <span className="text-xs font-medium tracking-wide text-muted-foreground">{s.label}</span>
                <span className="text-xl font-semibold">{formatUsd(s.totalSpend)}</span>
                <span className="text-xs text-muted-foreground">{formatUsd(s.dailyRate)}/day</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {source === "openai_enterprise" && allocation?.overageRateConfigured ? (
        <div className="rounded-2xl bg-surface-tonal px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Projected credit overage this cycle</p>
              <p
                className={`text-3xl font-bold tracking-tight sm:text-4xl ${
                  (allocation.projectedOverageCostUsd ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {formatUsd(allocation.projectedOverageCostUsd ?? 0)}
              </p>
              <p className="text-sm text-muted-foreground">
                {(allocation.projectedOverageCredits ?? 0) > 0
                  ? `${formatCredits(allocation.projectedOverageCredits ?? 0)} projected past ${formatCredits(allocation.monthlyCreditAllocation ?? 0)} allowance`
                  : `On pace to stay within ${formatCredits(allocation.monthlyCreditAllocation ?? 0)} allowance`}
                {" · @ "}
                {formatUsd(allocation.costPerOverageCreditUsd ?? 0)}/credit
                {allocation.billingStart && allocation.billingEnd
                  ? ` · cycle ${allocation.billingStart} → ${allocation.billingEnd}`
                  : ""}
              </p>
            </div>
            {(allocation.overageCostUsd ?? 0) > 0 ? (
              <div className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                MTD overage: {formatUsd(allocation.overageCostUsd ?? 0)}
                {(allocation.overageCredits ?? 0) > 0
                  ? ` (${formatCredits(allocation.overageCredits ?? 0)})`
                  : ""}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ForecastChart title="Spend forecast (daily)" result={result} budgetDailyPace={budgetDailyPace} />

      {/* Assumptions */}
      {result.assumptions.length > 0 && (
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold">Assumptions and caveats</h3>
          <p className="mb-3 text-xs text-muted-foreground">Read this before sharing projections outside the team.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
            {budgetDailyPace != null && (
              <li>Budget pace line shows the maximum daily spend to avoid exhausting the remaining budget before contract end.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
