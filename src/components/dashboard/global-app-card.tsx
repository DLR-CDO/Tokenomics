"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info, Layers } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TrendBadge } from "@/components/dashboard/trend-badge";
import { formatChartDate, formatCompactNumber, formatCredits, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ExecutiveStatus =
  | "credit-covered"
  | "healthy"
  | "funding-watch"
  | "projected-over"
  | "estimated"
  | "incomplete";

export type ExecutiveAppCard = {
  source: "cursor" | "openai_enterprise" | "openai" | "azure";
  label: string;
  href: string;
  periodLabel?: string;
  primaryUsd: number;
  primaryLabel: string;
  usageLabel: string;
  usageValue: number;
  tokens: number;
  requests: number;
  costPerMillionTokens: number | null;
  previousPrimaryUsd: number;
  changePct: number | null;
  projectedUsd: number;
  status: ExecutiveStatus;
  statusLabel: string;
  recommendation: string;
  warnings: string[];
  trend: { date: string; usd: number }[];
};

function statusClass(status: ExecutiveStatus): string {
  switch (status) {
    case "credit-covered":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "healthy":
      return "border-primary/20 bg-primary/10 text-primary";
    case "funding-watch":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "projected-over":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "estimated":
      return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "incomplete":
      return "border-muted-foreground/20 bg-muted/70 text-muted-foreground";
  }
}

function compactAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function usageValue(card: ExecutiveAppCard): string {
  if (card.usageLabel.toLowerCase().includes("credit")) return formatCredits(card.usageValue);
  return formatCompactNumber(card.usageValue);
}

function cardDomainMax(trend: ExecutiveAppCard["trend"]): number {
  const max = trend.reduce((largest, point) => Math.max(largest, point.usd), 0);
  if (max <= 0) return 1;
  if (max < 1) return 1;
  return max * 1.18;
}

function xAxisTickGap(pointCount: number): number {
  if (pointCount <= 1) return 0;
  if (pointCount <= 14) return 14;
  if (pointCount <= 45) return 28;
  return 48;
}

/**
 * Color assigned to each source in the aggregate chart. Order is stable and
 * matches the APP order the executive metrics endpoint returns, so colors
 * stay consistent between renders even if a source is missing.
 */
const SOURCE_CHART_COLOR: Record<ExecutiveAppCard["source"], string> = {
  cursor: "var(--chart-1)",
  openai_enterprise: "var(--chart-2)",
  openai: "var(--chart-3)",
  azure: "var(--chart-4)",
};

type AggregateSeriesPoint = { date: string; total: number } & Partial<
  Record<ExecutiveAppCard["source"], number>
>;

/**
 * Pivots per-card daily trend data into a wide row-per-date shape suitable
 * for a multi-series chart. Dates absent for a given source remain undefined
 * so recharts renders a gap (rather than a misleading zero), and `total`
 * sums only the sources that did report on that date.
 */
function buildAggregateSeries(sources: ExecutiveAppCard[]): AggregateSeriesPoint[] {
  const byDate = new Map<string, AggregateSeriesPoint>();
  for (const card of sources) {
    for (const point of card.trend) {
      const row = byDate.get(point.date) ?? { date: point.date, total: 0 };
      row[card.source] = (row[card.source] ?? 0) + point.usd;
      row.total += point.usd;
      byDate.set(point.date, row);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Reusable forecast tile shared by `GlobalAppCard` and `GlobalAggregateCard`.
 * The hover-tooltip + visible disclaimer make it explicit that the headline
 * number is a raw current-pace projection — no safety or growth margin is
 * applied here, unlike the values shown on the Forecast tab.
 */
function ForecastTile({ projectedUsd }: { projectedUsd: number }) {
  const tooltip =
    "Projected period spend at the current pace. Does not include a safety margin or growth assumption — see the Forecast tab for margin-adjusted recommendations.";
  return (
    <div className="rounded-xl bg-surface-container px-3 py-2">
      <div
        className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        title={tooltip}
      >
        <span>Forecast</span>
        <Info className="h-3 w-3 text-muted-foreground/70" aria-label={tooltip} />
      </div>
      <div className="mt-1 text-sm font-semibold">{formatUsd(projectedUsd)}</div>
      <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
        No safety/growth margin
      </div>
    </div>
  );
}

export function GlobalAppCard({
  card,
  href,
}: {
  card: ExecutiveAppCard;
  href: string;
}) {
  const hasTrend = card.trend.some((point) => point.usd > 0);
  const domainMax = cardDomainMax(card.trend);
  const tickGap = xAxisTickGap(card.trend.length);

  return (
    <Link
      href={href}
      className="group flex min-h-[360px] flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{card.label}</h2>
            {card.periodLabel ? (
              <span className="hidden rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                {card.periodLabel}
              </span>
            ) : null}
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {card.primaryLabel}
          </div>
        </div>
        <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", statusClass(card.status))}>
          {card.statusLabel}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">{formatUsd(card.primaryUsd)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Previous period: {formatUsd(card.previousPrimaryUsd)}
          </div>
        </div>
        {card.changePct === null ? (
          <span className="rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            New vs prior period
          </span>
        ) : (
          <TrendBadge changePct={card.changePct} label="vs prior period" />
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-surface-container px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{card.usageLabel}</div>
          <div className="mt-1 text-sm font-semibold">{usageValue(card)}</div>
        </div>
        <ForecastTile projectedUsd={card.projectedUsd} />
        <div className="rounded-xl bg-surface-container px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            $/1M tok
          </div>
          <div className="mt-1 text-sm font-semibold">
            {card.costPerMillionTokens === null ? "N/A" : formatUsd(card.costPerMillionTokens)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Daily spend/value trend</span>
          <span>Daily USD, card scale</span>
        </div>
        <div className="h-28 min-w-0">
          {hasTrend ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={card.trend} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id={`global-card-${card.source}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.45} />
                <XAxis
                  dataKey="date"
                  minTickGap={tickGap}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={(value) => formatChartDate(String(value))}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, domainMax]}
                  width={44}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={compactAxis}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 50, outline: "none" }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                    backgroundColor: "var(--color-popover)",
                    fontSize: 12,
                    opacity: 1,
                  }}
                  formatter={(value) => [formatUsd(Number(value ?? 0)), "USD"]}
                />
                <Area
                  type="monotone"
                  dataKey="usd"
                  fill={`url(#global-card-${card.source})`}
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/70 text-xs text-muted-foreground">
              No spend trend available for this period
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 rounded-xl bg-surface-tonal px-3 py-2 text-sm leading-relaxed text-foreground">
        {card.recommendation}
      </p>

      {card.warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {card.warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

/**
 * Full-width aggregate card summing every per-app card. Visually mirrors
 * `GlobalAppCard` but renders as a non-interactive `<section>` and skips
 * status-color treatments and warnings, since the aggregate is informational.
 *
 * The chart shows the total spend as a solid filled line plus one dotted
 * line per source (color-coded), with a legend so finance can see which
 * platform contributes which slice of demand.
 */
export function GlobalAggregateCard({ card, sources }: { card: ExecutiveAppCard; sources: ExecutiveAppCard[] }) {
  const hasTrend = card.trend.some((point) => point.usd > 0);
  const domainMax = cardDomainMax(card.trend);
  const tickGap = xAxisTickGap(card.trend.length);
  const seriesData = buildAggregateSeries(sources);

  return (
    <section className="flex min-h-[300px] w-full flex-col rounded-2xl border border-primary/30 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">{card.label}</h2>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {card.primaryLabel}
          </div>
        </div>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          {card.statusLabel}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tracking-tight">{formatUsd(card.primaryUsd)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Previous period: {formatUsd(card.previousPrimaryUsd)}
          </div>
        </div>
        {card.changePct === null ? (
          <span className="rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            New vs prior period
          </span>
        ) : (
          <TrendBadge changePct={card.changePct} label="vs prior period" />
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-surface-container px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{card.usageLabel}</div>
          <div className="mt-1 text-sm font-semibold">{usageValue(card)}</div>
        </div>
        <ForecastTile projectedUsd={card.projectedUsd} />
        <div className="rounded-xl bg-surface-container px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            $/1M tok
          </div>
          <div className="mt-1 text-sm font-semibold">
            {card.costPerMillionTokens === null ? "N/A" : formatUsd(card.costPerMillionTokens)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Daily spend/value trend (all apps)</span>
          <span>Total solid; per-app dotted</span>
        </div>
        <div className="h-44 min-w-0">
          {hasTrend ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={seriesData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="global-aggregate-card" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.45} />
                <XAxis
                  dataKey="date"
                  minTickGap={tickGap}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={(value) => formatChartDate(String(value))}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, domainMax]}
                  width={48}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={compactAxis}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 50, outline: "none" }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                    backgroundColor: "var(--color-popover)",
                    fontSize: 12,
                    opacity: 1,
                  }}
                  formatter={(value, name) => [formatUsd(Number(value ?? 0)), String(name)]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  iconType="line"
                  iconSize={12}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  fill="url(#global-aggregate-card)"
                  stroke="var(--color-primary)"
                  strokeWidth={2.4}
                  dot={false}
                  isAnimationActive={false}
                />
                {sources.map((source) => (
                  <Line
                    key={source.source}
                    type="monotone"
                    dataKey={source.source}
                    name={source.label}
                    stroke={SOURCE_CHART_COLOR[source.source]}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/70 text-xs text-muted-foreground">
              No spend trend available for this period
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 rounded-xl bg-surface-tonal px-3 py-2 text-sm leading-relaxed text-foreground">
        {card.recommendation}
      </p>
    </section>
  );
}
