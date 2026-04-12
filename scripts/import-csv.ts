import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";

const { dimMember, usageFacts } = schema;

const CSV_PATH = process.argv[2];
if (!CSV_PATH) {
  console.error("Usage: npx tsx scripts/import-csv.ts <path-to-csv>");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { max: 5 });
const db = drizzle(client, { schema });

const COST_CUTOFF = "2026-04-01T00:00:00.000Z";

type MetricKind = "tokens_in" | "tokens_out" | "cost_usd";

function hashId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

const memberCache = new Map<string, string>();

async function resolveMember(email: string): Promise<string> {
  const key = email.toLowerCase();
  const cached = memberCache.get(key);
  if (cached) return cached;

  const [existing] = await db
    .select({ id: dimMember.id })
    .from(dimMember)
    .where(and(eq(dimMember.sourceSystem, "cursor"), eq(dimMember.email, key)))
    .limit(1);

  if (existing) {
    memberCache.set(key, existing.id);
    return existing.id;
  }

  const [inserted] = await db
    .insert(dimMember)
    .values({
      sourceSystem: "cursor",
      externalKey: `csv_email:${key}`,
      displayName: key.split("@")[0] ?? key,
      email: key,
    })
    .onConflictDoUpdate({
      target: [dimMember.sourceSystem, dimMember.externalKey],
      set: { email: key, updatedAt: new Date() },
    })
    .returning({ id: dimMember.id });

  const id = inserted?.id;
  if (!id) throw new Error(`Failed to upsert member for ${email}`);
  memberCache.set(key, id);
  return id;
}

async function upsertFact(input: {
  occurredAt: Date;
  metricKind: MetricKind;
  amount: number;
  memberId: string | null;
  modelName: string | null;
  dimensionsJson: Record<string, unknown>;
  externalId: string;
}) {
  await db
    .insert(usageFacts)
    .values({
      occurredAt: input.occurredAt,
      sourceSystem: "cursor",
      metricKind: input.metricKind,
      amount: input.amount,
      memberId: input.memberId,
      modelId: null,
      modelName: input.modelName,
      mode: null,
      billingGroupId: null,
      billingGroupName: null,
      dimensionsJson: input.dimensionsJson,
      externalId: input.externalId,
    })
    .onConflictDoUpdate({
      target: [usageFacts.sourceSystem, usageFacts.externalId],
      set: {
        amount: sql`excluded.amount`,
        occurredAt: sql`excluded.occurred_at`,
        memberId: sql`excluded.member_id`,
        modelName: sql`excluded.model_name`,
        dimensionsJson: sql`excluded.dimensions_json`,
        ingestedAt: sql`now()`,
      },
    });
}

function safeInt(val: string | undefined): number {
  if (!val || val.trim() === "") return 0;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function safeFloat(val: string | undefined): number {
  if (!val || val.trim() === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

async function run() {
  const stats = {
    totalRows: 0,
    skipped: 0,
    tokensInUpserted: 0,
    tokensOutUpserted: 0,
    costUpserted: 0,
    costSkippedOverlap: 0,
    errors: 0,
    membersResolved: 0,
  };

  const BATCH_LOG_INTERVAL = 5000;
  const startTime = Date.now();

  const parser = createReadStream(CSV_PATH).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }),
  );

  for await (const row of parser) {
    stats.totalRows += 1;

    try {
      const dateStr: string = row["Date"] ?? "";
      const email: string = row["User"] ?? "";
      const kind: string = row["Kind"] ?? "";
      const model: string = row["Model"] ?? "";
      const maxMode: string = row["Max Mode"] ?? "";
      const inputWithCache = safeInt(row["Input (w/ Cache Write)"]);
      const inputWithoutCache = safeInt(row["Input (w/o Cache Write)"]);
      const cacheRead = safeInt(row["Cache Read"]);
      const outputTokens = safeInt(row["Output Tokens"]);
      const totalTokens = safeInt(row["Total Tokens"]);
      const cost = safeFloat(row["Cost"]);

      if (!dateStr || !email) {
        stats.skipped += 1;
        continue;
      }

      const ts = new Date(dateStr);
      if (Number.isNaN(ts.getTime())) {
        stats.skipped += 1;
        continue;
      }

      const totalInput = inputWithCache > 0 ? inputWithCache : inputWithoutCache;
      if (totalInput === 0 && outputTokens === 0 && cost === 0) {
        stats.skipped += 1;
        continue;
      }

      const memberId = await resolveMember(email);
      if (stats.totalRows <= 1 || !memberCache.has(email.toLowerCase())) {
        stats.membersResolved += 1;
      }

      const hash = hashId([dateStr, email, model, kind, String(totalTokens), String(cost)]);
      const dims: Record<string, unknown> = {
        kind,
        maxMode: maxMode === "Yes",
        cacheReadTokens: cacheRead,
        inputWithoutCacheWrite: inputWithoutCache,
        totalTokens,
        csvImport: true,
      };

      if (totalInput > 0) {
        await upsertFact({
          occurredAt: ts,
          metricKind: "tokens_in",
          amount: totalInput,
          memberId,
          modelName: model || null,
          dimensionsJson: dims,
          externalId: `csv:event:${hash}:in`,
        });
        stats.tokensInUpserted += 1;
      }

      if (outputTokens > 0) {
        await upsertFact({
          occurredAt: ts,
          metricKind: "tokens_out",
          amount: outputTokens,
          memberId,
          modelName: model || null,
          dimensionsJson: dims,
          externalId: `csv:event:${hash}:out`,
        });
        stats.tokensOutUpserted += 1;
      }

      if (cost > 0) {
        if (dateStr < COST_CUTOFF) {
          await upsertFact({
            occurredAt: ts,
            metricKind: "cost_usd",
            amount: cost,
            memberId,
            modelName: model || null,
            dimensionsJson: dims,
            externalId: `csv:event:${hash}:cost`,
          });
          stats.costUpserted += 1;
        } else {
          stats.costSkippedOverlap += 1;
        }
      }

      if (stats.totalRows % BATCH_LOG_INTERVAL === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  ... processed ${stats.totalRows} rows (${elapsed}s)`);
      }
    } catch (e) {
      stats.errors += 1;
      if (stats.errors <= 10) {
        console.error(`  Row ${stats.totalRows} error:`, e instanceof Error ? e.message : e);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== Import complete ===");
  console.log(`  Total CSV rows:         ${stats.totalRows}`);
  console.log(`  Skipped (empty/zero):   ${stats.skipped}`);
  console.log(`  tokens_in upserted:     ${stats.tokensInUpserted}`);
  console.log(`  tokens_out upserted:    ${stats.tokensOutUpserted}`);
  console.log(`  cost_usd upserted:      ${stats.costUpserted} (pre-${COST_CUTOFF.slice(0, 10)})`);
  console.log(`  cost skipped (overlap): ${stats.costSkippedOverlap} (post-${COST_CUTOFF.slice(0, 10)}, covered by daily_spend)`);
  console.log(`  Errors:                 ${stats.errors}`);
  console.log(`  Members resolved:       ${memberCache.size}`);
  console.log(`  Elapsed:                ${elapsed}s`);

  await client.end();
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
