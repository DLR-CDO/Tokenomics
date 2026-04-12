import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import {
  getRequestsBySubtype,
  getAgentEditsTimeseries,
  getTabsAnalytics,
  getMcpUsage,
  getCommandUsage,
  getFileExtensions,
  getPlansUsage,
  getRankedModels,
} from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";

    const [requestsByType, agentEdits, tabs, mcp, commands, extensions, plans, models] =
      await Promise.all([
        getRequestsBySubtype(filters, source),
        getAgentEditsTimeseries(filters, source),
        getTabsAnalytics(filters, source),
        getMcpUsage(filters, source),
        getCommandUsage(filters, source),
        getFileExtensions(filters, source),
        getPlansUsage(filters, source),
        getRankedModels(filters, source),
      ]);

    return NextResponse.json({
      requestsByType,
      agentEdits,
      tabs,
      mcp,
      commands,
      extensions,
      plans,
      models,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
