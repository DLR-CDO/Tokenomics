import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";

export async function GET() {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, "openai_enterprise_credits"))
      .limit(1);

    if (!row) return NextResponse.json({ importedAt: null });

    const data = row.value as { importedAt?: string };
    return NextResponse.json({ importedAt: data.importedAt ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
