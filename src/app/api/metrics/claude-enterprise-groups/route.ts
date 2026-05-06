import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getClaudeEnterpriseGroups } from "@/server/claude-enterprise-metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const modeParam = url.searchParams.get("mode");
    if (modeParam !== "chat_project" && modeParam !== "skill" && modeParam !== "connector") {
      return NextResponse.json({ error: "mode must be chat_project, skill, or connector" }, { status: 400 });
    }
    const groups = await getClaudeEnterpriseGroups(filters, modeParam);
    return NextResponse.json({ groups });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
