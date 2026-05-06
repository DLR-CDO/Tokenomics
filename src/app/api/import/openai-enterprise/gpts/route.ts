import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";
import { parseCsv } from "@/server/csv-parse";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function gptIdentity(gpt: Record<string, unknown>): string {
  const gptId = normalize(String(gpt.gptId ?? gpt.gpt_id ?? ""));
  if (gptId) return `id:${gptId}`;

  const name = normalize(String(gpt.gptName ?? gpt.gpt_name ?? ""));
  const creatorEmail = normalize(String(gpt.creatorEmail ?? gpt.gpt_creator_email ?? ""));
  const url = normalize(String(gpt.url ?? gpt.gpt_url ?? ""));
  return `fallback:${name}:${creatorEmail}:${url}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const db = getDb();
    const text = await file.text();
    const rows = parseCsv(text);

    let duplicateRowsWithinUpload = 0;
    let duplicateRowsAgainstExisting = 0;
    const incomingByIdentity = new Map<string, Record<string, unknown>>();

    for (const row of rows) {
      const gpt = {
        gptId: row.gpt_id ?? "",
        gptName: row.gpt_name ?? "",
        configType: row.config_type ?? "",
        description: row.gpt_description ?? "",
        url: row.gpt_url ?? "",
        creatorEmail: normalize(row.gpt_creator_email),
        isActive: row.is_active === "1" || normalize(row.is_active) === "true",
        firstDayActive: row.first_day_active_in_period ?? "",
        lastDayActive: row.last_day_active_in_period ?? "",
        messagesWorkspace: parseFloat(row.messages_workspace) || 0,
        uniqueMessagers: parseFloat(row.unique_messagers_workspace) || 0,
      };
      const key = gptIdentity(gpt);
      if (incomingByIdentity.has(key)) duplicateRowsWithinUpload++;
      incomingByIdentity.set(key, gpt);
    }

    const [existingRow] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, "openai_enterprise_gpts"))
      .limit(1);

    const existingData = existingRow?.value as { gpts?: Record<string, unknown>[] } | undefined;
    const mergedGpts = new Map<string, Record<string, unknown>>();
    for (const existing of existingData?.gpts ?? []) {
      const key = gptIdentity(existing);
      mergedGpts.set(key, existing);
    }
    for (const [key, gpt] of incomingByIdentity.entries()) {
      if (mergedGpts.has(key)) duplicateRowsAgainstExisting++;
      mergedGpts.set(key, gpt);
    }

    const importedAt = new Date().toISOString();

    await db
      .insert(dashboardSettings)
      .values({
        key: "openai_enterprise_gpts",
        value: { gpts: Array.from(mergedGpts.values()), importedAt } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: {
          value: { gpts: Array.from(mergedGpts.values()), importedAt } as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      totalRows: rows.length,
      dedupedRows: duplicateRowsWithinUpload + duplicateRowsAgainstExisting,
      insertedOrUpdatedRows: incomingByIdentity.size,
      importedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
