import { and, eq, gte, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings, usageFacts } from "@/db/schema";
import { getBillingWindow } from "@/server/billing-window";

interface SeatConfig {
  costPerSeatPerMonth?: number;
  seatCount?: number;
  annualCost?: number;
  billingResetDay?: number;
  freeCreditsPerSeatPerMonth?: number;
  costPerOverageCreditUsd?: number;
}

type SourceSystem = "cursor" | "openai" | "azure" | "openai_enterprise" | "claude_enterprise";
type MetricKind = "credits" | "cost_usd";

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

    const isEnterprise = source === "openai_enterprise";
    const dollarPoolConfigured = isEnterprise
      ? Boolean(config.annualCost && config.annualCost > 0)
      : Boolean(config.costPerSeatPerMonth && config.seatCount);
    const creditPoolConfigured = isEnterprise
      ? Boolean(
          config.freeCreditsPerSeatPerMonth &&
            config.freeCreditsPerSeatPerMonth > 0 &&
            config.seatCount &&
            config.seatCount > 0,
        )
      : false;
    const overageRateConfigured = isEnterprise
      ? creditPoolConfigured && Boolean(config.costPerOverageCreditUsd && config.costPerOverageCreditUsd > 0)
      : false;

    if (!dollarPoolConfigured && !creditPoolConfigured) {
      return NextResponse.json({ configured: false });
    }

    let billingStart: Date;
    let billingEnd: Date;

    if (isEnterprise) {
      const resetDay = config.billingResetDay ?? 1;
      const window = getBillingWindow(resetDay, now);
      billingStart = window.start;
      billingEnd = window.end;
    } else {
      billingStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      billingEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
    }

    const metricKind: MetricKind = isEnterprise ? "credits" : "cost_usd";

    const [usage] = await db
      .select({
        total: sql<number>`coalesce(sum(${usageFacts.amount}), 0)`,
      })
      .from(usageFacts)
      .where(
        and(
          eq(usageFacts.sourceSystem, source as SourceSystem),
          eq(usageFacts.metricKind, metricKind),
          gte(usageFacts.occurredAt, billingStart),
          lte(usageFacts.occurredAt, billingEnd),
        ),
      );

    const monthToDate = Number(usage?.total ?? 0);

    const msRemaining = billingEnd.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

    const totalDays = Math.ceil((billingEnd.getTime() - billingStart.getTime()) / (24 * 60 * 60 * 1000));
    const daysElapsed = totalDays - daysRemaining;
    const dailyBurn = daysElapsed > 0 ? monthToDate / daysElapsed : 0;
    const projectedMonthEnd = dailyBurn * totalDays;

    const monthlyAllocation = dollarPoolConfigured
      ? isEnterprise
        ? (config.annualCost ?? 0) / 12
        : (config.costPerSeatPerMonth ?? 0) * (config.seatCount ?? 0)
      : 0;
    const percentUsed = monthlyAllocation > 0 ? (monthToDate / monthlyAllocation) * 100 : 0;

    const baseResponse: Record<string, unknown> = {
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
      creditPoolConfigured,
      overageRateConfigured,
    };

    if (creditPoolConfigured) {
      const freeCreditsPerSeatPerMonth = config.freeCreditsPerSeatPerMonth ?? 0;
      const seatCount = config.seatCount ?? 0;
      const monthlyCreditAllocation = freeCreditsPerSeatPerMonth * seatCount;
      const creditPercentUsed =
        monthlyCreditAllocation > 0 ? (monthToDate / monthlyCreditAllocation) * 100 : 0;
      const creditDailyBurn = daysElapsed > 0 ? monthToDate / daysElapsed : 0;
      const projectedCreditMonthEnd = creditDailyBurn * totalDays;

      baseResponse.freeCreditsPerSeatPerMonth = freeCreditsPerSeatPerMonth;
      baseResponse.seatCount = seatCount;
      baseResponse.monthlyCreditAllocation = monthlyCreditAllocation;
      baseResponse.creditPercentUsed = creditPercentUsed;
      baseResponse.creditDailyBurn = creditDailyBurn;
      baseResponse.projectedCreditMonthEnd = projectedCreditMonthEnd;

      if (overageRateConfigured) {
        const costPerOverageCreditUsd = config.costPerOverageCreditUsd ?? 0;
        const overageCredits = Math.max(0, monthToDate - monthlyCreditAllocation);
        const overageCostUsd = overageCredits * costPerOverageCreditUsd;
        const projectedOverageCredits = Math.max(0, projectedCreditMonthEnd - monthlyCreditAllocation);
        const projectedOverageCostUsd = projectedOverageCredits * costPerOverageCreditUsd;

        baseResponse.costPerOverageCreditUsd = costPerOverageCreditUsd;
        baseResponse.overageCredits = overageCredits;
        baseResponse.overageCostUsd = overageCostUsd;
        baseResponse.projectedOverageCredits = projectedOverageCredits;
        baseResponse.projectedOverageCostUsd = projectedOverageCostUsd;
      }
    }

    return NextResponse.json(baseResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
