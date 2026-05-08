import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getClaudeEnterpriseSpend } from "@/server/claude-enterprise-metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const topUsers = Number.parseInt(url.searchParams.get("topUsers") ?? "", 10);
    const topModels = Number.parseInt(url.searchParams.get("topModels") ?? "", 10);
    const data = await getClaudeEnterpriseSpend(filters, {
      topUsers: Number.isFinite(topUsers) && topUsers > 0 ? topUsers : undefined,
      topModels: Number.isFinite(topModels) && topModels > 0 ? topModels : undefined,
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
