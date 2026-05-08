import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getClaudeEnterpriseTokens } from "@/server/claude-enterprise-metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const topUsers = Number.parseInt(url.searchParams.get("topUsers") ?? "", 10);
    const data = await getClaudeEnterpriseTokens(filters, {
      topUsers: Number.isFinite(topUsers) && topUsers > 0 ? topUsers : undefined,
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
