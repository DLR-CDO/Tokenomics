import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getOpenAIListRateTimeseries } from "@/server/openai-cost";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const result = await getOpenAIListRateTimeseries(filters);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
