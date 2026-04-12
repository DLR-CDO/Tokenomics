import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { connectorRuns } from "@/db/schema";

const OVERLAP_MS = 2 * 24 * 60 * 60 * 1000; // 2-day safety overlap

/**
 * Returns the start-of-window timestamp (in ms) for the next sync.
 *
 * If a previous successful sync exists, uses its watermark minus a 2-day
 * overlap buffer (re-fetched data is safely upserted via the unique
 * constraint on usage_facts). Falls back to the full lookback on first run.
 */
export async function getIncrementalStart(
  sourceSystem: string,
  fullLookbackMs: number,
): Promise<{ startMs: number; isIncremental: boolean }> {
  const db = getDb();

  const [lastRun] = await db
    .select({ watermarkAt: connectorRuns.watermarkAt })
    .from(connectorRuns)
    .where(
      and(
        eq(connectorRuns.sourceSystem, sourceSystem as any),
        eq(connectorRuns.status, "success" as any),
      ),
    )
    .orderBy(desc(connectorRuns.startedAt))
    .limit(1);

  if (lastRun?.watermarkAt) {
    const watermarkMs = lastRun.watermarkAt.getTime() - OVERLAP_MS;
    return { startMs: watermarkMs, isIncremental: true };
  }

  return { startMs: fullLookbackMs, isIncremental: false };
}
