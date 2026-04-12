import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getMcpUsage, getCommandUsage, getFileExtensions, getAiCommits } from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";

    const [mcp, commands, extensions, aiCommits] = await Promise.all([
      getMcpUsage(filters, source),
      getCommandUsage(filters, source),
      getFileExtensions(filters, source),
      getAiCommits(filters, source),
    ]);

    return NextResponse.json({ mcp, commands, extensions, aiCommits });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
