"use client";

import { Area, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ForecastResult } from "@/lib/forecast";
import { formatChartDate } from "@/lib/format";

/**
 * Window (in days) used to smooth the forward-looking forecast / interval
 * lines. The underlying daily projection injects weekday seasonality which
 * looks like high-frequency noise in the chart; a 7-day trailing average
 * collapses it to a clean trend without affecting any of the dollar totals
 * (those are computed independently from this chart series).
 */
const FORECAST_SMOOTH_WINDOW = 7;

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
      <div className="h-[360px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
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
              tickFormatter={(value) => formatChartDate(String(value))}
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
              wrapperStyle={{ zIndex: 50, outline: "none" }}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                backgroundColor: "var(--color-popover)",
                fontSize: 12,
                opacity: 1,
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

  // Smooth the forward series so weekday-seasonality pulses don't read as
  // chart noise. We average the raw projection with a trailing window that
  // includes the tail of history, so the smoothed line continues seamlessly
  // from where "actual" leaves off rather than starting at the first
  // forecast point's pulse.
  const tailHistory = result.history
    .slice(-Math.max(1, FORECAST_SMOOTH_WINDOW - 1))
    .map((p) => p.value);

  const smoothedForecast = trailingAverage(
    result.forecast.map((p) => p.value),
    FORECAST_SMOOTH_WINDOW,
    tailHistory,
  );
  const smoothedLow = trailingAverage(
    result.intervalLow.map((p) => p.value),
    FORECAST_SMOOTH_WINDOW,
    tailHistory,
  );
  const smoothedHigh = trailingAverage(
    result.intervalHigh.map((p) => p.value),
    FORECAST_SMOOTH_WINDOW,
    tailHistory,
  );

  for (let i = 0; i < result.forecast.length; i += 1) {
    const p = result.forecast[i]!;
    const row = map.get(p.date) ?? { date: p.date };
    row.forecast = smoothedForecast[i];
    row.lo = smoothedLow[i];
    row.hi = smoothedHigh[i];
    map.set(p.date, row);
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Trailing simple moving average. `seed` is appended to the front of the
 * stream so the very first output value already reflects the window's worth
 * of context (avoids a visible "ramp-up" at the join with the actual line).
 */
function trailingAverage(values: number[], window: number, seed: number[] = []): number[] {
  if (window <= 1) return values.slice();
  const out: number[] = [];
  const buffer = [...seed];
  for (const v of values) {
    buffer.push(v);
    if (buffer.length > window) buffer.shift();
    const sum = buffer.reduce((a, b) => a + b, 0);
    out.push(sum / buffer.length);
  }
  return out;
}
