import { and, eq, gte, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings, usageFacts } from "@/db/schema";

interface SeatConfig {
  costPerSeatPerMonth?: number;
  seatCount?: number;
  annualCost?: number;
  billingResetDay?: number;
}

function getBillingWindow(resetDay: number, now: Date): { start: Date; end: Date } {
  const year = now.getFullYear();
  const month = now.getMonth();

  let start: Date;
  let end: Date;

  if (now.getDate() >= resetDay) {
    start = new Date(Date.UTC(year, month, resetDay));
    end = new Date(Date.UTC(year, month + 1, resetDay - 1, 23, 59, 59, 999));
  } else {
    start = new Date(Date.UTC(year, month - 1, resetDay));
    end = new Date(Date.UTC(year, month, resetDay - 1, 23, 59, 59, 999));
  }

  return { start, end };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "cursor";

  try {
    const db = getDb();
    const seatKey = `seat_config_${source}`;

    const [seatRow] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, seatKey))
      .limit(1);

    if (!seatRow) {
      return NextResponse.json({ configured: false });
    }

    const config = seatRow.value as unknown as SeatConfig;
    const now = new Date();

    let monthlyAllocation: number;
    let billingStart: Date;
    let billingEnd: Date;

    if (source === "openai_enterprise") {
      if (!config.annualCost) return NextResponse.json({ configured: false });

      monthlyAllocation = config.annualCost / 12;
      const resetDay = config.billingResetDay ?? 1;
      const window = getBillingWindow(resetDay, now);
      billingStart = window.start;
      billingEnd = window.end;
    } else {
      if (!config.costPerSeatPerMonth || !config.seatCount) {
        return NextResponse.json({ configured: false });
      }
      monthlyAllocation = config.costPerSeatPerMonth * config.seatCount;
      billingStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      billingEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
    }

    const metricKind = source === "openai_enterprise" ? "credits" : "cost_usd";

    const [usage] = await db
      .select({
        total: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      })
      .from(usageFacts)
      .where(
        and(
          eq(usageFacts.sourceSystem, source as "cursor" | "openai" | "openai_enterprise"),
          eq(usageFacts.metricKind, metricKind as any),
          gte(usageFacts.occurredAt, billingStart),
          lte(usageFacts.occurredAt, billingEnd),
        ),
      );

    const monthToDate = Number(usage?.total ?? 0);
    const percentUsed = monthlyAllocation > 0 ? (monthToDate / monthlyAllocation) * 100 : 0;

    const msRemaining = billingEnd.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

    const totalDays = Math.ceil((billingEnd.getTime() - billingStart.getTime()) / (24 * 60 * 60 * 1000));
    const daysElapsed = totalDays - daysRemaining;
    const dailyBurn = daysElapsed > 0 ? monthToDate / daysElapsed : 0;
    const projectedMonthEnd = dailyBurn * totalDays;

    return NextResponse.json({
      configured: true,
      source,
      monthlyAllocation,
      monthToDateCredits: monthToDate,
      percentUsed,
      daysRemaining,
      daysElapsed,
      totalDays,
      dailyBurn,
      projectedMonthEnd,
      billingStart: billingStart.toISOString().slice(0, 10),
      billingEnd: billingEnd.toISOString().slice(0, 10),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
