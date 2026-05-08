import { NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";
import { readExtraUsagePolicy, type ClaudeExtraUsagePolicy } from "@/server/claude-enterprise-burn";

const KEY = "claude_extra_usage_policy";

const policySchema = z.object({
  enabled: z.boolean().optional(),
  thresholdUsd: z.number().finite().nonnegative().optional(),
  reloadAmountUsd: z.number().finite().positive().optional(),
  startedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startedOn must be YYYY-MM-DD")
    .nullable()
    .optional(),
  notes: z.string().max(280).optional(),
});

export async function GET() {
  try {
    const policy = await readExtraUsagePolicy();
    return NextResponse.json({ policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const parsed = policySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const existing = await readExtraUsagePolicy();
    const next: ClaudeExtraUsagePolicy = {
      enabled: parsed.data.enabled ?? existing.enabled,
      thresholdUsd: parsed.data.thresholdUsd ?? existing.thresholdUsd,
      reloadAmountUsd: parsed.data.reloadAmountUsd ?? existing.reloadAmountUsd,
      startedOn:
        parsed.data.startedOn === null
          ? null
          : (parsed.data.startedOn ?? existing.startedOn),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : existing.notes ? { notes: existing.notes } : {}),
    };

    const value: Record<string, unknown> = {
      enabled: next.enabled,
      thresholdUsd: next.thresholdUsd,
      reloadAmountUsd: next.reloadAmountUsd,
      startedOn: next.startedOn,
    };
    if (next.notes) value.notes = next.notes;

    const db = getDb();
    await db
      .insert(dashboardSettings)
      .values({ key: KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: { value, updatedAt: new Date() },
      });

    return NextResponse.json({ policy: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
