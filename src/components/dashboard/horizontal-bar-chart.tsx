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

interface HorizontalBarChartProps {
  title: string;
  description?: string;
  data: Record<string, unknown>[];
  dataKey?: string;
  nameKey?: string;
  formatValue?: (v: number) => string;
  height?: number;
  /** Optional second line under the value, e.g. a USD valuation. Returning null suppresses it. */
  tooltipDetail?: (value: number, label: string) => string | null;
}

interface TooltipPayloadItem {
  value?: unknown;
  payload?: Record<string, unknown>;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  nameKey: string;
  formatValue: (v: number) => string;
  tooltipDetail?: (value: number, label: string) => string | null;
}

function CustomTooltip({ active, payload, nameKey, formatValue, tooltipDetail }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const raw = item?.value;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  const valueLabel = Number.isFinite(numeric) ? formatValue(numeric) : String(raw ?? "");
  const labelRaw = item?.payload?.[nameKey];
  const label = typeof labelRaw === "string" ? labelRaw : String(labelRaw ?? "");
  const detail =
    tooltipDetail && Number.isFinite(numeric) ? tooltipDetail(numeric, label) : null;

  return (
    <div
      className="rounded-xl bg-card p-2.5 text-xs shadow-lg"
      style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }}
    >
      {label ? <div className="font-medium">{label}</div> : null}
      <div className="text-foreground">{valueLabel}</div>
      {detail ? <div className="mt-0.5 text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export function HorizontalBarChart({
  title,
  description,
  data,
  dataKey = "value",
  nameKey = "name",
  formatValue,
  height,
  tooltipDetail,
}: HorizontalBarChartProps) {
  const fmt = formatValue ?? formatUsd;
  const chartHeight = height ?? Math.max(180, data.length * 40 + 40);

  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div style={{ height: chartHeight }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
              cursor={{ fill: "var(--color-muted)", fillOpacity: 0.2 }}
              content={
                <CustomTooltip
                  nameKey={nameKey}
                  formatValue={fmt}
                  tooltipDetail={tooltipDetail}
                />
              }
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
