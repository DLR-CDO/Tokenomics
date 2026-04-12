"use client";

import {
  ComposedChart,
  Legend,
  Line,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";

type TimeseriesRow = Record<string, unknown> & { date: string };

function compactTick(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export type SeriesConfig = {
  dataKey: string;
  name: string;
  type: "area" | "line";
  yAxisId: "left" | "right";
  color: string;
};

export const SERIES_PRESETS = {
  activity: [
    { dataKey: "requests", name: "Requests", type: "area" as const, yAxisId: "left" as const, color: "var(--color-chart-1)" },
  ],
  spend: [
    { dataKey: "costUsd", name: "Spend (USD)", type: "area" as const, yAxisId: "left" as const, color: "var(--color-chart-5)" },
  ],
  linesAdded: [
    { dataKey: "linesAdded", name: "Lines added", type: "area" as const, yAxisId: "left" as const, color: "var(--color-chart-2)" },
  ],
  adoption: [
    { dataKey: "dau", name: "DAU", type: "area" as const, yAxisId: "left" as const, color: "var(--color-chart-4)" },
  ],
} satisfies Record<string, SeriesConfig[]>;

export function TimeseriesChart({
  title,
  description,
  data,
  series,
  compact = false,
  syncId = "dashboard",
}: {
  title: string;
  description?: string;
  data: TimeseriesRow[];
  series: SeriesConfig[];
  compact?: boolean;
  syncId?: string;
}) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const hasRight = series.some((s) => s.yAxisId === "right");
  const height = compact ? 120 : 320;

  const toggleSeries = (dataKey: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  return (
    <div className={compact ? "" : "rounded-2xl bg-card p-5 shadow-sm"}>
      {!compact && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart 
            data={data} 
            syncId={syncId}
            margin={compact ? { left: 0, right: 0, top: 4, bottom: 4 } : { left: 8, right: 8, top: 8, bottom: 8 }}
          >
            <defs>
              {series.map((s) => (
                <linearGradient key={`grad-${s.dataKey}`} id={`grad-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={compact ? 0.45 : 0.3} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={compact ? 0.05 : 0} />
                </linearGradient>
              ))}
            </defs>
            {!compact && (
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
            )}
            {compact ? (
              <YAxis hide width={0} />
            ) : (
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={compactTick}
              />
            )}
            {!compact && hasRight && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={compactTick}
              />
            )}
            {!compact && (
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "none",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
                  backgroundColor: "var(--color-card)",
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return [Number.isFinite(n) ? n.toLocaleString() : String(value ?? ""), String(name ?? "")];
                }}
              />
            )}
            {!compact && (
              <Legend 
                wrapperStyle={{ fontSize: 12, cursor: "pointer" }} 
                onClick={(e) => { if (typeof e.dataKey === "string") toggleSeries(e.dataKey); }}
              />
            )}
            {series.map((s) =>
              s.type === "area" ? (
                <Area
                  key={s.dataKey}
                  hide={hiddenSeries.has(s.dataKey)}
                  yAxisId={compact ? undefined : s.yAxisId}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  fill={`url(#grad-${s.dataKey})`}
                  stroke={s.color}
                  strokeWidth={compact ? 2 : 2}
                  dot={false}
                  isAnimationActive={!compact}
                />
              ) : (
                <Line
                  key={s.dataKey}
                  hide={hiddenSeries.has(s.dataKey)}
                  yAxisId={compact ? undefined : s.yAxisId}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={s.color}
                  dot={false}
                  strokeWidth={compact ? 2 : 2}
                  isAnimationActive={!compact}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
