import { NextResponse } from "next/server";

import { parseDashboardFilters } from "@/lib/filters";
import { getBillingGroupSpend } from "@/server/metrics";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = parseDashboardFilters(url.searchParams);
    const source = url.searchParams.get("source") ?? "cursor";

    const groups = await getBillingGroupSpend(filters, source);

    return NextResponse.json({ groups });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
