import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";
import { parseCsv } from "@/server/csv-parse";

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

    const gpts = rows.map((row) => ({
      gptId: row.gpt_id ?? "",
      gptName: row.gpt_name ?? "",
      configType: row.config_type ?? "",
      description: row.gpt_description ?? "",
      url: row.gpt_url ?? "",
      creatorEmail: row.gpt_creator_email ?? "",
      isActive: row.is_active === "1",
      firstDayActive: row.first_day_active_in_period ?? "",
      lastDayActive: row.last_day_active_in_period ?? "",
      messagesWorkspace: parseFloat(row.messages_workspace) || 0,
      uniqueMessagers: parseFloat(row.unique_messagers_workspace) || 0,
    }));

    await db
      .insert(dashboardSettings)
      .values({
        key: "openai_enterprise_gpts",
        value: { gpts, importedAt: new Date().toISOString() } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: {
          value: { gpts, importedAt: new Date().toISOString() } as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true, totalRows: gpts.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
