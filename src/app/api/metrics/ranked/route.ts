import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getRankedMembers, getRankedModels, getEnhancedRankedMembers, getAllMembersWithUsage } from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";
    const dimension = url.searchParams.get("dimension") ?? "member";
    const enhanced = url.searchParams.get("enhanced") === "true";

    if (dimension === "model") {
      const models = await getRankedModels(filters, source);
      return NextResponse.json({ dimension: "model", data: models });
    }

    const roster = url.searchParams.get("roster") === "true";

    if (roster) {
      const members = await getAllMembersWithUsage(filters, source);
      return NextResponse.json({ dimension: "member", data: members });
    }

    if (enhanced) {
      const members = await getEnhancedRankedMembers(filters, source);
      return NextResponse.json({ dimension: "member", data: members });
    }

    const members = await getRankedMembers(filters, source);
    return NextResponse.json({ dimension: "member", data: members });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
