import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getGlobalExecutiveMetrics } from "@/server/global-executive-metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const offsetRaw = Number.parseInt(url.searchParams.get("cycleOffset") ?? "0", 10);
    const cycleOffset = Number.isFinite(offsetRaw) ? Math.min(0, offsetRaw) : 0;
    const data = await getGlobalExecutiveMetrics(filters, {
      useSourceCycles: url.searchParams.get("datePreset") === "cycle",
      cycleOffset,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
