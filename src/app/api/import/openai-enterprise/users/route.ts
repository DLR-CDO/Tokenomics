import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings, dimMember } from "@/db/schema";
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

    let membersUpserted = 0;
    const userData: Record<string, unknown>[] = [];

    for (const row of rows) {
      const email = row.email;
      if (!email) continue;

      const publicId = row.public_id ?? "";
      const name = row.name ?? "";
      const role = row.user_role ?? row.role ?? "";
      const externalKey = publicId || email.toLowerCase();

      await db
        .insert(dimMember)
        .values({
          sourceSystem: "openai_enterprise",
          externalKey,
          displayName: name || email,
          email: email.toLowerCase(),
          role: role || null,
        })
        .onConflictDoUpdate({
          target: [dimMember.sourceSystem, dimMember.externalKey],
          set: {
            displayName: name || email,
            email: email.toLowerCase(),
            role: role || sql`dim_member.role`,
            updatedAt: new Date(),
          },
        });
      membersUpserted++;

      userData.push({
        email: email.toLowerCase(),
        name,
        publicId,
        role: row.role ?? "",
        userRole: row.user_role ?? "",
        department: row.department ?? "",
        groups: row.groups ?? "",
        userStatus: row.user_status ?? "",
        createdOrInvitedDate: row.created_or_invited_date ?? "",
        isActive: row.is_active ?? "",
        firstDayActive: row.first_day_active_in_period ?? "",
        lastDayActive: row.last_day_active_in_period ?? "",
        messages: parseFloat(row.messages) || 0,
        messagesRank: parseFloat(row.messages_rank) || 0,
        modelToMessages: row.model_to_messages ?? "",
        gptMessages: parseFloat(row.gpt_messages) || 0,
        toolMessages: parseFloat(row.tool_messages) || 0,
        toolToMessages: row.tool_to_messages ?? "",
        projectMessages: parseFloat(row.project_messages) || 0,
        projectsCreated: parseFloat(row.projects_created) || 0,
        creditsUsed: parseFloat(row.credits_used) || 0,
        lastDayActiveDate: row.last_day_active ?? "",
      });
    }

    await db
      .insert(dashboardSettings)
      .values({
        key: "openai_enterprise_users",
        value: { users: userData, importedAt: new Date().toISOString() } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: {
          value: { users: userData, importedAt: new Date().toISOString() } as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      membersUpserted,
      totalRows: rows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
