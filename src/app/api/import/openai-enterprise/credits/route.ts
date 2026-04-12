import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { dimMember, usageFacts } from "@/db/schema";
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
    const memberCache = new Map<string, string>();

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
        let memberId = memberCache.get(cacheKey);
        if (!memberId) {
          memberId = await resolveMemberId(db, email, name, publicId);
          memberCache.set(cacheKey, memberId);
        }

        const occurredAt = new Date(`${date}T00:00:00.000Z`);
        const externalId = `oe:credit:${date}:${cacheKey}:${usageType}`;

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
              externalId,
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

        if (quantity !== 0) {
          const reqExternalId = `oe:qty:${date}:${cacheKey}:${usageType}`;
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

    return NextResponse.json({
      ok: true,
      rowsUpserted: totalUpserted,
      filesProcessed: files.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
