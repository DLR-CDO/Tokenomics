"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format";

type BurnForecast = {
  policy: {
    enabled: boolean;
    thresholdUsd: number;
    reloadAmountUsd: number;
    startedOn: string | null;
    notes?: string;
  };
  seatFeeAnnualUsd: number;
  consumedSinceStart: number;
  trailing30Burn: number;
  trailing30MonthlyEquivalent: number;
  projectedDaysToNextRebill: number | null;
  projectedRebillsPerYear: number;
  projectedAnnualExtras: number;
  projectedAnnualTotal: number;
  cumulativeSinceCycleStart: { date: string; cumulative: number }[];
  rebillMarkers: { date: string; rebillNumber: number }[];
  latestDataPoint: string | null;
};

function formatDays(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 30) return `${value.toFixed(0)} d`;
  return `${value.toFixed(1)} d`;
}

function formatNumber(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

export function ClaudeBurnForecastCard() {
  const [data, setData] = useState<BurnForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/metrics/claude-enterprise-burn", { cache: "no-store" });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(
            (json && typeof json === "object" && "error" in json
              ? String((json as { error: unknown }).error)
              : null) ?? `Burn fetch failed (HTTP ${res.status})`,
          );
        }
        const json = (await res.json()) as BurnForecast;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Burn &amp; Forecast</CardTitle>
        <CardDescription>
          Read-only projection driven entirely by Anthropic Analytics consumption (per-product daily cost facts) plus
          your auto-reload policy. Trailing-30-day burn rate is annualised to estimate next rebill date and total
          annual cost. Updated on every page load.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : error ? (
          <div className="rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            {error}
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">No burn data available yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Stat
                label="Consumed since policy start"
                value={formatUsd(data.consumedSinceStart)}
                hint={data.policy.startedOn ? `From ${data.policy.startedOn}` : "Last 90 days (no start date set)"}
              />
              <Stat
                label="Trailing-30 burn / day"
                value={formatUsd(data.trailing30Burn)}
                hint={`≈ ${formatUsd(data.trailing30MonthlyEquivalent)} / month`}
              />
              <Stat
                label="Days to next rebill"
                value={formatDays(data.projectedDaysToNextRebill)}
                hint={`Each rebill is ${formatUsd(data.policy.reloadAmountUsd)}`}
              />
              <Stat
                label="Projected rebills / year"
                value={formatNumber(data.projectedRebillsPerYear)}
                hint={`${data.rebillMarkers.length} so far in window`}
              />
              <Stat
                label="Projected annual extras"
                value={formatUsd(data.projectedAnnualExtras)}
                hint="Trailing-30 burn × 365"
              />
              <Stat
                label="Projected annual total"
                value={formatUsd(data.projectedAnnualTotal)}
                hint={`Seat fee ${formatUsd(data.seatFeeAnnualUsd)} + extras`}
              />
            </div>
            <div className="rounded-lg border border-blue-300/40 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
              {data.latestDataPoint ? (
                <>
                  Latest cost data point: <code className="rounded bg-white/60 px-1 py-0.5 dark:bg-black/30">{data.latestDataPoint}</code>.
                  Anthropic data has a 3-day lag and revises for up to 30 days.
                </>
              ) : (
                <>No cost data yet. Run a Claude Enterprise sync once <code>CLAUDE_COST_ENDPOINTS_ENABLED</code> is set.</>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
