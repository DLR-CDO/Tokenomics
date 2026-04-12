import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { dashboardSettings, dimMember, usageFacts } from "../src/db/schema";
import { parseCsv } from "../src/server/csv-parse";

const DOWNLOADS = "/Users/TLorino/Downloads";

const CREDIT_FILES = [
  "Digital Realty Credit Usage Report (Aug 25 - Sep 25).csv",
  "Digital Realty Credit Usage Report (Sep 25 - Oct 25).csv",
  "Digital Realty Credit Usage Report (Oct 25 - Nov 25).csv",
  "Digital Realty Credit Usage Report (Nov 25 - Dec 25).csv",
  "Digital Realty Credit Usage Report (Dec 25 - Jan 25).csv",
  "Digital Realty Credit Usage Report (Jan 25 - Feb 25).csv",
  "Digital Realty Credit Usage Report (Feb 25 - Mar 25).csv",
  "Digital Realty Credit Usage Report (Mar 25 - Apr 25).csv",
];

const USERS_FILE = "Digital Realty users export (2025-05-01 - 2026-04-12).csv";
const GPTS_FILE = "Digital Realty gpts export (2025-05-01 - 2026-04-12).csv";
const PROJECTS_FILE = "Digital Realty projects export (2025-05-01 - 2026-04-12).csv";

async function resolveMemberId(
  db: ReturnType<typeof getDb>,
  email: string,
  name: string,
  publicId: string,
): Promise<string> {
  const externalKey = publicId || email.toLowerCase();

  const [row] = await db
    .insert(dimMember)
    .values({
      sourceSystem: "openai_enterprise",
      externalKey,
      displayName: name || email,
      email: email.toLowerCase(),
      role: null,
    })
    .onConflictDoUpdate({
      target: [dimMember.sourceSystem, dimMember.externalKey],
      set: {
        displayName: name || email,
        email: email.toLowerCase(),
        updatedAt: new Date(),
      },
    })
    .returning({ id: dimMember.id });

  if (row) return row.id;

  const [found] = await db
    .select({ id: dimMember.id })
    .from(dimMember)
    .where(
      and(
        eq(dimMember.sourceSystem, "openai_enterprise"),
        eq(dimMember.externalKey, externalKey),
      ),
    )
    .limit(1);
  return found!.id;
}

async function importCredits() {
  const db = getDb();
  const memberCache = new Map<string, string>();
  let totalUpserted = 0;

  for (const file of CREDIT_FILES) {
    const filePath = path.join(DOWNLOADS, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP (not found): ${file}`);
      continue;
    }

    const text = fs.readFileSync(filePath, "utf-8");
    const rows = parseCsv(text);
    let fileUpserted = 0;

    for (const row of rows) {
      const date = row.date_partition;
      const email = row.email;
      const name = row.name ?? "";
      const publicId = row.public_id ?? "";
      const usageType = row.usage_type;
      const credits = parseFloat(row.usage_credits) || 0;
      const quantity = parseFloat(row.usage_quantity) || 0;

      if (!date || !email || !usageType) continue;

      const cacheKey = publicId || email.toLowerCase();
      let memberId = memberCache.get(cacheKey);
      if (!memberId) {
        memberId = await resolveMemberId(db, email, name, publicId);
        memberCache.set(cacheKey, memberId);
      }

      const occurredAt = new Date(`${date}T00:00:00.000Z`);

      if (credits !== 0) {
        await db
          .insert(usageFacts)
          .values({
            occurredAt,
            sourceSystem: "openai_enterprise",
            metricKind: "credits",
            amount: credits,
            memberId,
            modelName: usageType,
            externalId: `oe:credit:${date}:${cacheKey}:${usageType}`,
            dimensionsJson: { usageType, quantity, units: row.usage_units ?? "counts" },
          })
          .onConflictDoUpdate({
            target: [usageFacts.sourceSystem, usageFacts.externalId],
            set: {
              amount: sql`excluded.amount`,
              memberId: sql`excluded.member_id`,
              modelName: sql`excluded.model_name`,
              dimensionsJson: sql`excluded.dimensions_json`,
              ingestedAt: sql`now()`,
            },
          });
        fileUpserted++;
      }

      if (quantity !== 0) {
        await db
          .insert(usageFacts)
          .values({
            occurredAt,
            sourceSystem: "openai_enterprise",
            metricKind: "requests",
            amount: quantity,
            memberId,
            modelName: usageType,
            externalId: `oe:qty:${date}:${cacheKey}:${usageType}`,
            dimensionsJson: { usageType, units: row.usage_units ?? "counts" },
          })
          .onConflictDoUpdate({
            target: [usageFacts.sourceSystem, usageFacts.externalId],
            set: {
              amount: sql`excluded.amount`,
              memberId: sql`excluded.member_id`,
              modelName: sql`excluded.model_name`,
              dimensionsJson: sql`excluded.dimensions_json`,
              ingestedAt: sql`now()`,
            },
          });
        fileUpserted++;
      }
    }

    totalUpserted += fileUpserted;
    console.log(`  ${file}: ${fileUpserted} rows upserted`);
  }

  console.log(`Credits total: ${totalUpserted} rows upserted`);
}

async function importUsers() {
  const filePath = path.join(DOWNLOADS, USERS_FILE);
  if (!fs.existsSync(filePath)) {
    console.log("  SKIP users (not found)");
    return;
  }

  const db = getDb();
  const text = fs.readFileSync(filePath, "utf-8");
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

  console.log(`Users: ${membersUpserted} members upserted, ${userData.length} stored in settings`);
}

async function importGpts() {
  const filePath = path.join(DOWNLOADS, GPTS_FILE);
  if (!fs.existsSync(filePath)) {
    console.log("  SKIP gpts (not found)");
    return;
  }

  const db = getDb();
  const text = fs.readFileSync(filePath, "utf-8");
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

  console.log(`GPTs: ${gpts.length} records stored`);
}

async function importProjects() {
  const filePath = path.join(DOWNLOADS, PROJECTS_FILE);
  if (!fs.existsSync(filePath)) {
    console.log("  SKIP projects (not found)");
    return;
  }

  const db = getDb();
  const text = fs.readFileSync(filePath, "utf-8");
  const rows = parseCsv(text);

  const projects = rows.map((row) => ({
    projectId: row.project_id ?? "",
    projectName: row.project_name ?? "",
    configType: row.config_type ?? "",
    description: row.project_description ?? "",
    url: row.project_url ?? "",
    creatorEmail: row.project_creator_email ?? "",
    isActive: row.is_active === "1",
    firstDayActive: row.first_day_active_in_period ?? "",
    lastDayActive: row.last_day_active_in_period ?? "",
    messagesWorkspace: parseFloat(row.messages_workspace) || 0,
    uniqueMessagers: parseFloat(row.unique_messagers_workspace) || 0,
  }));

  await db
    .insert(dashboardSettings)
    .values({
      key: "openai_enterprise_projects",
      value: { projects, importedAt: new Date().toISOString() } as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dashboardSettings.key],
      set: {
        value: { projects, importedAt: new Date().toISOString() } as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });

  console.log(`Projects: ${projects.length} records stored`);
}

async function main() {
  console.log("=== Seeding OpenAI Enterprise CSV data ===\n");

  console.log("1. Importing users...");
  await importUsers();

  console.log("\n2. Importing credit usage reports...");
  await importCredits();

  console.log("\n3. Importing GPTs...");
  await importGpts();

  console.log("\n4. Importing projects...");
  await importProjects();

  console.log("\n=== Done ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
