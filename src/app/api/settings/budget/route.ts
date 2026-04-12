import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";
import type { SourceSystem } from "@/lib/filters";

export interface ContractBudget {
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

    const [row] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, budgetKey))
      .limit(1);

    if (!row) return NextResponse.json({ budget: null });
    return NextResponse.json({ budget: row.value as unknown as ContractBudget });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = (searchParams.get("source") ?? "cursor") as SourceSystem;

  try {
    const body = (await request.json()) as ContractBudget;

    if (!body.amount || !body.startDate || !body.endDate) {
      return NextResponse.json({ error: "amount, startDate, and endDate are required" }, { status: 400 });
    }

    const db = getDb();
    const budgetKey = budgetKeyForSource(source);
    const value: Record<string, unknown> = {
      amount: body.amount,
      currency: body.currency || "USD",
      startDate: body.startDate,
      endDate: body.endDate,
      label: body.label || "",
    };

    await db
      .insert(dashboardSettings)
      .values({ key: budgetKey, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: { value, updatedAt: new Date() },
      });

    return NextResponse.json({ budget: value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
