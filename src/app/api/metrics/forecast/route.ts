import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { forecastFromDaily, computeContractRecommendation } from "@/lib/forecast";
import { getActiveBillingCycle, getTimeseries } from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";
    const series = await getTimeseries(filters, source);
    const points = series.map((r) => ({ date: r.date, value: r.costUsd }));

    const cycle = await getActiveBillingCycle(filters, source);
    const horizonParam = url.searchParams.get("horizon");
    const horizon = horizonParam ? new Date(horizonParam) : cycle?.cycleEnd ? new Date(cycle.cycleEnd) : new Date();

    const forecast = forecastFromDaily(points, horizon);

    const daysWithSpend = points.filter((p) => p.value > 0).length || 1;
    const totalSpend = points.reduce((s, p) => s + p.value, 0);
    const dailyBurnRate = totalSpend / daysWithSpend;
    const yearEnd = new Date("2026-12-31");
    const recommendation = computeContractRecommendation(dailyBurnRate, yearEnd);

    return NextResponse.json({ cycle, forecast, recommendation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
