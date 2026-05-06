import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings, dimMember } from "@/db/schema";
import { parseCsv } from "@/server/csv-parse";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function userIdentity(user: Record<string, unknown>): string {
  const publicId = normalize(String(user.publicId ?? user.public_id ?? ""));
  const email = normalize(String(user.email ?? ""));
  return publicId || email;
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

    let membersUpserted = 0;
    let duplicateRowsWithinUpload = 0;
    let duplicateRowsAgainstExisting = 0;
    const usersByIdentity = new Map<string, Record<string, unknown>>();

    for (const row of rows) {
      const email = row.email;
      if (!email) continue;

      const publicId = row.public_id ?? "";
      const name = row.name ?? "";
      const normalizedEmail = normalize(email);
      const externalKey = normalize(publicId) || normalizedEmail;
      if (!externalKey) continue;

      if (usersByIdentity.has(externalKey)) duplicateRowsWithinUpload++;

      usersByIdentity.set(externalKey, {
        email: normalizedEmail,
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

    for (const [externalKey, user] of usersByIdentity.entries()) {
      const email = String(user.email ?? "");
      const name = String(user.name ?? "");
      const role = String(user.userRole ?? user.role ?? "");

      await db
        .insert(dimMember)
        .values({
          sourceSystem: "openai_enterprise",
          externalKey,
          displayName: name || email,
          email,
          role: role || null,
        })
        .onConflictDoUpdate({
          target: [dimMember.sourceSystem, dimMember.externalKey],
          set: {
            displayName: name || email,
            email,
            role: role || sql`dim_member.role`,
            updatedAt: new Date(),
          },
        });
      membersUpserted++;
    }

    const [existingRow] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, "openai_enterprise_users"))
      .limit(1);

    const existingData = existingRow?.value as { users?: Record<string, unknown>[] } | undefined;
    const mergedUsers = new Map<string, Record<string, unknown>>();

    for (const existing of existingData?.users ?? []) {
      const key = userIdentity(existing);
      if (!key) continue;
      mergedUsers.set(key, existing);
    }

    for (const [key, user] of usersByIdentity.entries()) {
      if (mergedUsers.has(key)) duplicateRowsAgainstExisting++;
      mergedUsers.set(key, user);
    }

    const importedAt = new Date().toISOString();
    await db
      .insert(dashboardSettings)
      .values({
        key: "openai_enterprise_users",
        value: { users: Array.from(mergedUsers.values()), importedAt } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: {
          value: { users: Array.from(mergedUsers.values()), importedAt } as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      membersUpserted,
      totalRows: rows.length,
      dedupedRows: duplicateRowsWithinUpload + duplicateRowsAgainstExisting,
      insertedOrUpdatedRows: usersByIdentity.size,
      importedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
