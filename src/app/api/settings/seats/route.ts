import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";

export interface SeatConfig {
  costPerSeatPerMonth?: number;
  seatCount?: number;
  annualCost?: number;
  billingResetDay?: number;
}

function seatKeyForSource(source: string): string {
  return `seat_config_${source}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "cursor";

  try {
    const db = getDb();
    const key = seatKeyForSource(source);

    const [row] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, key))
      .limit(1);

    if (!row) return NextResponse.json({ config: null });
    return NextResponse.json({ config: row.value as unknown as SeatConfig });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "cursor";

  try {
    const body = (await request.json()) as SeatConfig;
    const db = getDb();
    const key = seatKeyForSource(source);

    const value: Record<string, unknown> = {};
    if (body.costPerSeatPerMonth != null) value.costPerSeatPerMonth = body.costPerSeatPerMonth;
    if (body.seatCount != null) value.seatCount = body.seatCount;
    if (body.annualCost != null) value.annualCost = body.annualCost;
    if (body.billingResetDay != null) value.billingResetDay = body.billingResetDay;

    await db
      .insert(dashboardSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: { value, updatedAt: new Date() },
      });

    return NextResponse.json({ config: value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
