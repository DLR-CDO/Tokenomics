import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";

const KEY = "claude_enterprise_seat_snapshot";

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, KEY))
      .limit(1);

    if (!row) return NextResponse.json({ snapshot: null });
    return NextResponse.json({ snapshot: row.value, capturedAt: row.updatedAt?.toISOString?.() ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
