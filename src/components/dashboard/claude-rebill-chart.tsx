"use client";

import {
  Bar,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";

import { formatChartDate, formatUsd } from "@/lib/format";

type CumulativePoint = { date: string; daily: number; cumulative: number };
type RebillMarker = { date: string; rebillNumber: number };

function compactUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Visualises the Prepaid Extra Usage burn pattern as a combined chart:
 *   - Daily extras $ as bars
 *   - "Cumulative since last rebill" as a line that resets each time the
 *     cumulative crosses an integer multiple of `reloadAmountUsd` (these
 *     reset points are passed in as `rebillMarkers`)
 *   - A horizontal reference line at the auto-reload amount, so the rebill
 *     trigger point is visible at a glance
 *
 * Both Overview and Spend pages render this with the same data shape coming
 * from /api/metrics/claude-enterprise-burn.
 */
export function ClaudeRebillChart({
  title,
  description,
  cumulative,
  rebillMarkers,
  reloadAmountUsd,
  height = 320,
  syncId = "cl-rebill",
}: {
  title: string;
  description?: string;
  cumulative: CumulativePoint[];
  rebillMarkers: RebillMarker[];
  reloadAmountUsd: number;
  height?: number;
  syncId?: string;
}) {
  const data = useMemo(() => {
    if (cumulative.length === 0) return [];
    const markerByDate = new Set(rebillMarkers.map((m) => m.date));
    let sinceLastRebill = 0;
    return cumulative.map((p) => {
      sinceLastRebill += p.daily;
      const point = {
        date: p.date,
        daily: p.daily,
        sinceLastRebill,
      };
      if (markerByDate.has(p.date)) sinceLastRebill = 0;
      return point;
    });
  }, [cumulative, rebillMarkers]);

  if (data.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground shadow-sm">
        {title}: no extras consumption recorded yet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={data} syncId={syncId} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              tickFormatter={(value) => formatChartDate(String(value))}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={compactUsd}
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
              formatter={(value: unknown, name: unknown) => {
                const n = typeof value === "number" ? value : Number(value);
                return [Number.isFinite(n) ? formatUsd(n) : String(value ?? ""), String(name ?? "")];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine
              y={reloadAmountUsd}
              yAxisId="left"
              stroke="var(--color-chart-5)"
              strokeDasharray="4 4"
              label={{
                value: `Rebill at ${compactUsd(reloadAmountUsd)}`,
                position: "right",
                fill: "var(--color-muted-foreground)",
                fontSize: 11,
              }}
            />
            {rebillMarkers.map((m) => (
              <ReferenceLine
                key={`rebill-${m.rebillNumber}-${m.date}`}
                x={m.date}
                yAxisId="left"
                stroke="var(--color-chart-5)"
                strokeDasharray="2 6"
                label={{
                  value: `#${m.rebillNumber}`,
                  position: "top",
                  fill: "var(--color-muted-foreground)",
                  fontSize: 10,
                }}
              />
            ))}
            <Bar yAxisId="left" dataKey="daily" name="Daily extras" fill="var(--color-chart-2)" radius={[2, 2, 0, 0]} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="sinceLastRebill"
              name="Cumulative since last rebill"
              stroke="var(--color-chart-1)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
