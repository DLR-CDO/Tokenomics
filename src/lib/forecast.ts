import { addDays, differenceInCalendarDays, formatISO, parseISO, startOfDay } from "date-fns";

export type DailyPoint = { date: string; value: number };

function parseDay(date: string): Date {
  return startOfDay(parseISO(date));
}

export function movingAverage(values: number[], window: number): number[] {
  if (window <= 0) return values.slice();
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

export function weekdayFactors(points: DailyPoint[]): number[] {
  // Returns factors indexed 0..6 for Sun..Sat (JS getUTCDay)
  const sums = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
  for (const p of points) {
    const d = parseDay(p.date);
    const wd = d.getUTCDay();
    sums[wd].sum += p.value;
    sums[wd].n += 1;
  }
  const means = sums.map((s) => (s.n > 0 ? s.sum / s.n : 1));
  const overall = means.reduce((a, b) => a + b, 0) / 7 || 1;
  return means.map((m) => (overall > 0 ? m / overall : 1));
}

export interface ForecastResult {
  history: DailyPoint[];
  forecast: DailyPoint[];
  intervalLow: DailyPoint[];
  intervalHigh: DailyPoint[];
  assumptions: string[];
}

export function forecastFromDaily(
  points: DailyPoint[],
  horizonEnd: Date,
  options: { smoothWindow?: number; residualSigma?: number } = {},
): ForecastResult {
  const smoothWindow = options.smoothWindow ?? 7;
  const residualSigma = options.residualSigma ?? 1.5;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const assumptions = [
    "Projection uses recent daily spend with a 7-day moving average baseline.",
    "Weekday seasonality is estimated from history and applied to future days.",
    "Intervals are a simple residual band and widen with the horizon.",
    "Does not model pricing changes, hiring waves, or model mix shifts.",
  ];

  if (sorted.length < 3) {
    return {
      history: sorted,
      forecast: [],
      intervalLow: [],
      intervalHigh: [],
      assumptions,
    };
  }

  const values = sorted.map((p) => p.value);
  const smoothed = movingAverage(values, Math.min(smoothWindow, values.length));
  const residuals = values.map((v, i) => v - smoothed[i]);
  const sigma =
    Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, residuals.length - 1)) || residualSigma;

  const factors = weekdayFactors(sorted);
  const last = sorted[sorted.length - 1]!;
  const lastDay = parseDay(last.date);
  const lastSmoothed = smoothed[smoothed.length - 1] ?? last.value;

  const daysAhead = Math.max(0, differenceInCalendarDays(startOfDay(horizonEnd), lastDay));
  const forecast: DailyPoint[] = [];
  const intervalLow: DailyPoint[] = [];
  const intervalHigh: DailyPoint[] = [];

  for (let i = 1; i <= daysAhead; i += 1) {
    const d = addDays(lastDay, i);
    const wd = d.getUTCDay();
    const factor = factors[wd] ?? 1;
    const projected = Math.max(0, lastSmoothed * factor);
    const widen = 1 + i * 0.03;
    forecast.push({ date: formatISO(d, { representation: "date" }), value: projected });
    intervalLow.push({ date: formatISO(d, { representation: "date" }), value: Math.max(0, projected - sigma * widen) });
    intervalHigh.push({ date: formatISO(d, { representation: "date" }), value: Math.max(0, projected + sigma * widen) });
  }

  return { history: sorted, forecast, intervalLow, intervalHigh, assumptions };
}

export type ScenarioResult = {
  label: string;
  totalSpend: number;
  dailyRate: number;
};

export type ContractRecommendation = {
  recommendedAmount: number;
  dailyBurnRate: number;
  daysRemaining: number;
  scenarios: ScenarioResult[];
};

export function computeContractRecommendation(
  dailyBurnRate: number,
  contractEndDate: Date,
  safetyMargin = 1.15,
): ContractRecommendation {
  const now = new Date();
  const daysRemaining = Math.max(0, differenceInCalendarDays(startOfDay(contractEndDate), startOfDay(now)));
  const baseTotal = dailyBurnRate * daysRemaining;
  const recommendedAmount = baseTotal * safetyMargin;

  const scenarios: ScenarioResult[] = [
    {
      label: "At current rate",
      totalSpend: baseTotal,
      dailyRate: dailyBurnRate,
    },
    {
      label: "If usage grows 10%",
      totalSpend: dailyBurnRate * 1.1 * daysRemaining,
      dailyRate: dailyBurnRate * 1.1,
    },
    {
      label: "If usage drops 10%",
      totalSpend: dailyBurnRate * 0.9 * daysRemaining,
      dailyRate: dailyBurnRate * 0.9,
    },
  ];

  return { recommendedAmount, dailyBurnRate, daysRemaining, scenarios };
}
