"use client";

import { type ReactNode, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import { TrendBadge } from "./trend-badge";

export type KpiItem = {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  color?: string;
  trend?: number;
  trendLabel?: string;
};

function KpiTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative ml-1 inline-flex cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <svg className="h-3.5 w-3.5 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {show && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

export function KpiGrid({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex flex-col gap-1 rounded-2xl bg-surface-container px-5 py-4"
          >
            <div className="flex items-center gap-1.5">
              {Icon && (
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={item.color ? { color: item.color } : undefined}
                />
              )}
              <span className="text-xs font-medium tracking-wide text-muted-foreground">
                {item.label}
              </span>
              {item.hint && <KpiTooltip text={item.hint} />}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-2xl font-semibold tracking-tight">{item.value}</div>
              {item.trend !== undefined && (
                <TrendBadge 
                  changePct={item.trend} 
                  label={item.trendLabel} 
                  size="sm" 
                  className="bg-transparent px-0"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HeroBurndown({
  spent,
  total,
  remaining,
  percentUsed,
  depletionLabel,
  children,
}: {
  spent: number;
  total: number;
  remaining: number;
  percentUsed: number;
  depletionLabel: string;
  children?: ReactNode;
}) {
  const pct = Math.min(percentUsed, 100);
  const isWarning = pct > 75;
  const isDanger = pct > 90;

  return (
    <div className="rounded-2xl bg-surface-tonal px-6 py-6 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Contract Budget</p>
          <p className="text-3xl font-bold tracking-tight sm:text-4xl">
            {formatUsd(remaining)}{" "}
            <span className="text-base font-normal text-muted-foreground">remaining</span>
          </p>
          <p className="text-sm text-muted-foreground">{depletionLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">
            {formatUsd(spent)} of {formatUsd(total)}
          </p>
        </div>
      </div>
      <div className="group relative mt-4 h-2.5 overflow-hidden rounded-full bg-background/60">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: isDanger
              ? "var(--color-destructive)"
              : isWarning
                ? "var(--color-chart-3)"
                : "var(--color-primary)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="rounded-md bg-foreground px-2 py-1 text-[10px] text-background shadow-sm">
            {pct.toFixed(1)}% used
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function formatTokens(value: number): string {
  return `${formatCompactNumber(value)} tok`;
}

export function formatRequests(value: number): string {
  return `${formatCompactNumber(value)} req`;
}

export { formatUsd } from "@/lib/format";
