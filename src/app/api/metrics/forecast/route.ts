import { differenceInCalendarDays, startOfDay } from "date-fns";
import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { forecastFromDaily, computeContractRecommendation } from "@/lib/forecast";
import { readForecastSettings, toMultiplier } from "@/lib/forecast-settings";
import {
  getGlobalDailyUsdTimeseries,
  getGlobalForecastSummary,
} from "@/server/global-executive-metrics";
import { getActiveBillingCycle, getTimeseries } from "@/server/metrics";

const TRAILING_WINDOW_DAYS = 30;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Average daily value over the most recent N days of realised history. Days
 * after `now` are excluded so future-padded series can't dilute the rate.
 * Mirrors the helper in global-executive-metrics so per-app and global use
 * the same burn-rate methodology.
 */
function trailingDailyRate(
  daily: { date: string; value: number }[],
  windowDays = TRAILING_WINDOW_DAYS,
  now = new Date(),
): number {
  if (daily.length === 0) return 0;
  const todayIso = startOfUtcDay(now).toISOString().slice(0, 10);
  const historical = [...daily]
    .filter((d) => d.date <= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (historical.length === 0) return 0;
  const tail = historical.slice(-Math.max(1, Math.min(windowDays, historical.length)));
  return tail.reduce((s, d) => s + d.value, 0) / tail.length;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";

    const isGlobal = source === "global";
    const points = isGlobal
      ? await getGlobalDailyUsdTimeseries(filters)
      : (await getTimeseries(filters, source)).map((r) => ({ date: r.date, value: r.costUsd }));

    const cycle = await getActiveBillingCycle(filters, source);

    // Horizon priority:
    //   1. ?horizon= explicit override
    //   2. filter.to (so the chart respects the user's selected end date)
    //   3. active billing cycle end (legacy fallback)
    //   4. today
    const horizonParam = url.searchParams.get("horizon");
    const horizon = horizonParam
      ? new Date(horizonParam)
      : filters.to
        ? new Date(filters.to)
        : cycle?.cycleEnd
          ? new Date(cycle.cycleEnd)
          : new Date();

    const forecast = forecastFromDaily(points, horizon);

    const yearEnd = new Date("2026-12-31");
    const settings = await readForecastSettings();
    const safetyMargin = toMultiplier(settings.safetyMarginPct);

    if (isGlobal) {
      // Use the same per-app run-rate methodology the Overview uses so the
      // recommendation reconciles with the Global Overview headline. The
      // recommendation now represents the projected total annual spend (with
      // configured safety margin), not just the remaining-period top-up.
      const summary = await getGlobalForecastSummary(filters);
      const today = new Date();
      const daysRemaining = Math.max(0, differenceInCalendarDays(startOfDay(yearEnd), startOfDay(today)));
      const totalAnnualDays = 365;
      const dailyBurnRate = summary.projectedTotal / totalAnnualDays;
      const recommendation = {
        recommendedAmount: summary.projectedTotal * safetyMargin,
        dailyBurnRate,
        daysRemaining,
        scenarios: [
          {
            label: "At current pace (annual)",
            totalSpend: summary.projectedTotal,
            dailyRate: dailyBurnRate,
          },
          {
            label: "If usage grows 10%",
            totalSpend: summary.projectedTotal * 1.1,
            dailyRate: dailyBurnRate * 1.1,
          },
          {
            label: "If usage drops 10%",
            totalSpend: summary.projectedTotal * 0.9,
            dailyRate: dailyBurnRate * 0.9,
          },
        ],
      };

      return NextResponse.json({
        cycle,
        forecast,
        recommendation,
        forecastSettings: settings,
        globalSummary: {
          ytdSpend: summary.ytdSpend,
          projectedTotal: summary.projectedTotal,
          recommendedAnnual: summary.projectedTotal * safetyMargin,
          safetyMargin,
          safetyMarginPct: settings.safetyMarginPct,
          perApp: summary.perApp,
        },
      });
    }

    // Per-app path: trailing-30-day burn rate × remaining days × margin.
    const dailyBurnRate = trailingDailyRate(points, TRAILING_WINDOW_DAYS);
    const recommendation = computeContractRecommendation(dailyBurnRate, yearEnd, safetyMargin);

    return NextResponse.json({ cycle, forecast, recommendation, forecastSettings: settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
