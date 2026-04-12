"use client";

import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { useState } from "react";

function compactTick(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export type StackedSeriesConfig = {
  dataKey: string;
  name: string;
  color: string;
};

export function StackedTimeseriesChart({
  title,
  description,
  data,
  keys,
  height = 320,
  syncId = "dashboard",
}: {
  title: string;
  description?: string;
  data: Record<string, unknown>[];
  keys: StackedSeriesConfig[];
  height?: number;
  syncId?: string;
}) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  const toggleKey = (dataKey: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart 
            data={data} 
            syncId={syncId}
            margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
          >
            <defs>
              {keys.map((k) => (
                <linearGradient key={`grad-${k.dataKey}`} id={`sg-${k.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={k.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={k.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={56}
              tickFormatter={compactTick}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "none",
                boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
                backgroundColor: "var(--color-card)",
                fontSize: 12,
              }}
              formatter={(value: unknown, name: unknown) => {
                const n = typeof value === "number" ? value : Number(value);
                return [Number.isFinite(n) ? n.toLocaleString() : String(value ?? ""), String(name ?? "")];
              }}
            />
            <Legend 
              wrapperStyle={{ fontSize: 12, cursor: "pointer" }} 
              onClick={(e) => { if (typeof e.dataKey === "string") toggleKey(e.dataKey); }}
            />
            {keys.map((k) => (
              <Area
                key={k.dataKey}
                hide={hiddenKeys.has(k.dataKey)}
                type="monotone"
                dataKey={k.dataKey}
                name={k.name}
                fill={`url(#sg-${k.dataKey})`}
                stroke={k.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
