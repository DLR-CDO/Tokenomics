import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";
import { parseCsv } from "@/server/csv-parse";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function projectIdentity(project: Record<string, unknown>): string {
  const projectId = normalize(String(project.projectId ?? project.project_id ?? ""));
  if (projectId) return `id:${projectId}`;

  const projectName = normalize(String(project.projectName ?? project.project_name ?? ""));
  const creatorEmail = normalize(String(project.creatorEmail ?? project.project_creator_email ?? ""));
  const url = normalize(String(project.url ?? project.project_url ?? ""));
  return `fallback:${projectName}:${creatorEmail}:${url}`;
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
      const project = {
        projectId: row.project_id ?? "",
        projectName: row.project_name ?? "",
        configType: row.config_type ?? "",
        description: row.project_description ?? "",
        url: row.project_url ?? "",
        creatorEmail: normalize(row.project_creator_email),
        isActive: row.is_active === "1" || normalize(row.is_active) === "true",
        firstDayActive: row.first_day_active_in_period ?? "",
        lastDayActive: row.last_day_active_in_period ?? "",
        messagesWorkspace: parseFloat(row.messages_workspace) || 0,
        uniqueMessagers: parseFloat(row.unique_messagers_workspace) || 0,
      };
      const key = projectIdentity(project);
      if (incomingByIdentity.has(key)) duplicateRowsWithinUpload++;
      incomingByIdentity.set(key, project);
    }

    const [existingRow] = await db
      .select()
      .from(dashboardSettings)
      .where(eq(dashboardSettings.key, "openai_enterprise_projects"))
      .limit(1);

    const existingData = existingRow?.value as { projects?: Record<string, unknown>[] } | undefined;
    const mergedProjects = new Map<string, Record<string, unknown>>();
    for (const existing of existingData?.projects ?? []) {
      const key = projectIdentity(existing);
      mergedProjects.set(key, existing);
    }
    for (const [key, project] of incomingByIdentity.entries()) {
      if (mergedProjects.has(key)) duplicateRowsAgainstExisting++;
      mergedProjects.set(key, project);
    }

    const importedAt = new Date().toISOString();

    await db
      .insert(dashboardSettings)
      .values({
        key: "openai_enterprise_projects",
        value: { projects: Array.from(mergedProjects.values()), importedAt } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: {
          value: { projects: Array.from(mergedProjects.values()), importedAt } as Record<string, unknown>,
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
