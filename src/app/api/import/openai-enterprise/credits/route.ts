import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dashboardSettings, dimMember, usageFacts } from "@/db/schema";
import { parseCsv } from "@/server/csv-parse";

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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("file") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const db = getDb();
    let totalUpserted = 0;
    let duplicateRowsWithinUpload = 0;
    const memberCache = new Map<string, string>();
    const seenFactIds = new Set<string>();

    for (const file of files) {
      const text = await file.text();
      const rows = parseCsv(text);

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
        const occurredAt = new Date(`${date}T00:00:00.000Z`);
        const creditExternalId = `oe:credit:${date}:${cacheKey}:${usageType}`;
        const reqExternalId = `oe:qty:${date}:${cacheKey}:${usageType}`;

        const shouldWriteCredits = credits !== 0;
        const shouldWriteRequests = quantity !== 0;
        if (!shouldWriteCredits && !shouldWriteRequests) continue;

        if (
          (shouldWriteCredits && seenFactIds.has(creditExternalId)) ||
          (shouldWriteRequests && seenFactIds.has(reqExternalId))
        ) {
          duplicateRowsWithinUpload++;
          continue;
        }

        let memberId = memberCache.get(cacheKey);
        if (!memberId) {
          memberId = await resolveMemberId(db, email, name, publicId);
          memberCache.set(cacheKey, memberId);
        }

        if (shouldWriteCredits) {
          seenFactIds.add(creditExternalId);
          await db
            .insert(usageFacts)
            .values({
              occurredAt,
              sourceSystem: "openai_enterprise",
              metricKind: "credits",
              amount: credits,
              memberId,
              modelName: usageType,
              externalId: creditExternalId,
              dimensionsJson: {
                usageType,
                quantity,
                units: row.usage_units ?? "counts",
              },
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
          totalUpserted++;
        }

        if (shouldWriteRequests) {
          seenFactIds.add(reqExternalId);
          await db
            .insert(usageFacts)
            .values({
              occurredAt,
              sourceSystem: "openai_enterprise",
              metricKind: "requests",
              amount: quantity,
              memberId,
              modelName: usageType,
              externalId: reqExternalId,
              dimensionsJson: {
                usageType,
                units: row.usage_units ?? "counts",
              },
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
          totalUpserted++;
        }
      }
    }

    const importedAt = new Date().toISOString();
    await db
      .insert(dashboardSettings)
      .values({
        key: "openai_enterprise_credits",
        value: { importedAt } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dashboardSettings.key],
        set: {
          value: { importedAt } as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      rowsUpserted: totalUpserted,
      dedupedRows: duplicateRowsWithinUpload,
      insertedOrUpdatedRows: totalUpserted,
      filesProcessed: files.length,
      importedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
