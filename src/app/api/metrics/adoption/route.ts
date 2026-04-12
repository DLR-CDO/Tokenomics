import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getDauBreakdown, getClientVersions, getAiCommits } from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";

    const [dauBreakdown, clientVersions, aiCommits] = await Promise.all([
      getDauBreakdown(filters, source),
      getClientVersions(filters, source),
      getAiCommits(filters, source),
    ]);

    return NextResponse.json({ dauBreakdown, clientVersions, aiCommits });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
