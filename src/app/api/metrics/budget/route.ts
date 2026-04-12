import { and, eq, gte, lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings, usageFacts } from "@/db/schema";
import type { SourceSystem } from "@/lib/filters";

interface ContractBudget {
  amount: number;
  currency: string;
  startDate: string;
  endDate: string;
  label: string;
}

function budgetKeyForSource(source: SourceSystem): string {
  return source === "cursor" ? "contract_budget" : `contract_budget_${source}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = (searchParams.get("source") ?? "cursor") as SourceSystem;

  try {
    const db = getDb();
    const budgetKey = budgetKeyForSource(source);

    const [setting] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, budgetKey))
      .limit(1);

    if (!setting) {
      return NextResponse.json({ configured: false });
    }

    const budget = setting.value as unknown as ContractBudget;
    const startDate = new Date(budget.startDate);
    const endDate = new Date(budget.endDate);

    const isCursor = source === "cursor";
    const [row] = await db
      .select({
        spent: isCursor
          ? sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' and ${usageFacts.externalId} not like 'cursor:spend:cycle:%' then ${usageFacts.amount} else 0 end), 0)`
          : sql<number>`coalesce(sum(case when ${usageFacts.metricKind} = 'cost_usd' then ${usageFacts.amount} else 0 end), 0)`,
      })
      .from(usageFacts)
      .where(
        and(
          eq(usageFacts.sourceSystem, source),
          gte(usageFacts.occurredAt, startDate),
          lte(usageFacts.occurredAt, endDate),
        ),
      );

    const spent = Number(row?.spent ?? 0);
    const remaining = Math.max(0, budget.amount - spent);
    const now = new Date();
    const daysElapsed = Math.max(1, (Math.min(now.getTime(), endDate.getTime()) - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const dailyBurnRate = spent / daysElapsed;
    const daysUntilDepleted = dailyBurnRate > 0 ? remaining / dailyBurnRate : Infinity;
    const projectedDepletionDate = dailyBurnRate > 0
      ? new Date(now.getTime() + daysUntilDepleted * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;
    const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
    const totalDaysInContract = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    const daysRemainingInContract = Math.max(0, (endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    return NextResponse.json({
      configured: true,
      budget: {
        amount: budget.amount,
        currency: budget.currency,
        startDate: budget.startDate,
        endDate: budget.endDate,
        label: budget.label,
      },
      metrics: {
        spent: Math.round(spent * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        percentUsed: Math.round(percentUsed * 10) / 10,
        dailyBurnRate: Math.round(dailyBurnRate * 100) / 100,
        daysUntilDepleted: Number.isFinite(daysUntilDepleted) ? Math.round(daysUntilDepleted) : null,
        projectedDepletionDate,
        daysElapsed: Math.round(daysElapsed),
        totalDaysInContract: Math.round(totalDaysInContract),
        daysRemainingInContract: Math.round(daysRemainingInContract),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
