"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";

import { formatUsd } from "@/lib/format";

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export function HorizontalBarChart({
  title,
  description,
  data,
  dataKey = "value",
  nameKey = "name",
  formatValue,
  height,
}: {
  title: string;
  description?: string;
  data: Record<string, unknown>[];
  dataKey?: string;
  nameKey?: string;
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const fmt = formatValue ?? formatUsd;
  const chartHeight = height ?? Math.max(180, data.length * 40 + 40);

  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div style={{ height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey={nameKey}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              width={130}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "none",
                boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
                backgroundColor: "var(--color-card)",
                fontSize: 12,
              }}
              formatter={(value: unknown) => {
                const n = typeof value === "number" ? value : Number(value);
                return [Number.isFinite(n) ? fmt(n) : String(value ?? ""), ""];
              }}
            />
            <Bar dataKey={dataKey} radius={[0, 6, 6, 0]} barSize={24}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
