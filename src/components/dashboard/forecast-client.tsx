"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ForecastChart } from "@/components/dashboard/forecast-chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContractRecommendation, ForecastResult } from "@/lib/forecast";
import { formatUsd } from "@/lib/format";

type ForecastPayload = {
  cycle: { cycleStart: string; cycleEnd: string; label: string | null } | null;
  forecast: ForecastResult;
  recommendation: ContractRecommendation;
};

type BudgetData = {
  configured: boolean;
  budget?: { amount: number; endDate: string };
  metrics?: { remaining: number; daysRemainingInContract: number; dailyBurnRate: number };
};

export function ForecastClient({ source = "cursor" }: { source?: string }) {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [payload, setPayload] = useState<ForecastPayload | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [fRes, bRes] = await Promise.all([
          fetch(`/api/metrics/forecast?${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/budget?source=${source}`, { cache: "no-store" }),
        ]);
        const fJson = await fRes.json();
        const bJson = await bRes.json();
        if (!fRes.ok) throw new Error(fJson.error ?? "Failed to load forecast");
        if (!cancelled) {
          setPayload(fJson as ForecastPayload);
          setBudgetData(bJson as BudgetData);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

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
  if (!result) return null;

  const budgetDailyPace = budgetData?.configured && budgetData.metrics
    ? budgetData.metrics.remaining / Math.max(1, budgetData.metrics.daysRemainingInContract)
    : null;

  return (
    <div className="space-y-6">
      {/* Hero recommendation */}
      {rec && rec.recommendedAmount > 0 && (
        <div className="rounded-2xl bg-surface-tonal px-6 py-6 sm:px-8">
          <p className="text-sm font-medium text-muted-foreground">Recommended next contract (through 12/31)</p>
          <p className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            {formatUsd(rec.recommendedAmount)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Based on {formatUsd(rec.dailyBurnRate)}/day burn rate over {rec.daysRemaining} remaining days, plus a 15% safety margin.
          </p>
        </div>
      )}

      {/* Scenario cards */}
      {rec && rec.scenarios.length > 0 && (
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
      )}

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
