import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getAzureUsageBreakdown } from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "azure";
    const data = await getAzureUsageBreakdown(filters, source);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
