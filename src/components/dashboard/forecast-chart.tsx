"use client";

import { Area, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ForecastResult } from "@/lib/forecast";

export function ForecastChart({
  title,
  result,
  budgetDailyPace,
}: {
  title: string;
  result: ForecastResult;
  budgetDailyPace?: number | null;
}) {
  const merged = mergeForecast(result);

  return (
    <div className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">Historical daily spend (USD) with smoothed extrapolation and confidence band.</p>
      </div>
      <div className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={merged} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <defs>
              <linearGradient id="grad-band" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-4)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--color-chart-4)" stopOpacity={0.02} />
              </linearGradient>
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
              width={52}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "none",
                boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
                backgroundColor: "var(--color-card)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="hi"
              name="Upper"
              fill="url(#grad-band)"
              stroke="var(--color-chart-4)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line type="monotone" dataKey="lo" name="Lower" stroke="var(--color-chart-4)" dot={false} strokeWidth={1} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--color-chart-2)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="forecast" name="Forecast" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} />
            {budgetDailyPace != null && budgetDailyPace > 0 ? (
              <ReferenceLine
                y={budgetDailyPace}
                stroke="var(--color-chart-5)"
                strokeDasharray="8 4"
                strokeWidth={2}
                label={{ value: `Budget pace ($${Math.round(budgetDailyPace)}/day)`, position: "insideTopRight", fontSize: 11, fill: "var(--color-chart-5)" }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function mergeForecast(result: ForecastResult) {
  const map = new Map<string, { date: string; actual?: number; forecast?: number; lo?: number; hi?: number }>();

  for (const p of result.history) {
    map.set(p.date, { date: p.date, actual: p.value });
  }
  for (let i = 0; i < result.forecast.length; i += 1) {
    const p = result.forecast[i]!;
    const lo = result.intervalLow[i]?.value;
    const hi = result.intervalHigh[i]?.value;
    const row = map.get(p.date) ?? { date: p.date };
    row.forecast = p.value;
    row.lo = lo;
    row.hi = hi;
    map.set(p.date, row);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
