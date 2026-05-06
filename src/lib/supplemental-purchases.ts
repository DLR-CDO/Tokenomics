/**
 * Supplemental purchases — one-off contract top-ups (e.g. mid-cycle credit
 * additions for Claude Enterprise) that aren't captured by the seat contract
 * `annualCost` field. Stored per source in `dashboard_settings` under the key
 * `supplemental_purchases_<source>` as `{ purchases: [...] }`.
 *
 * The data model is intentionally source-agnostic so OpenAI Enterprise (or any
 * future product with mid-cycle top-ups) can opt in without further changes.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";

export const supplementalPurchaseSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  amountUsd: z.number().finite().nonnegative(),
  note: z.string().max(280).optional(),
});

export type SupplementalPurchase = z.infer<typeof supplementalPurchaseSchema>;

export const supplementalPurchasesPayloadSchema = z.object({
  purchases: z.array(supplementalPurchaseSchema),
});

export function settingsKey(source: string): string {
  return `supplemental_purchases_${source}`;
}

export async function readSupplementalPurchases(
  source: string,
): Promise<SupplementalPurchase[]> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, settingsKey(source)))
    .limit(1);

  if (!row) return [];
  const value = row.value as { purchases?: unknown } | undefined;
  const parsed = supplementalPurchasesPayloadSchema.safeParse({
    purchases: Array.isArray(value?.purchases) ? value!.purchases : [],
  });
  return parsed.success ? parsed.data.purchases : [];
}

export async function writeSupplementalPurchases(
  source: string,
  purchases: SupplementalPurchase[],
): Promise<void> {
  const db = getDb();
  const value = { purchases };
  await db
    .insert(dashboardSettings)
    .values({ key: settingsKey(source), value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dashboardSettings.key],
      set: { value, updatedAt: new Date() },
    });
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Sum supplemental purchases whose `date` falls within [from, to] inclusive.
 * Comparison is done on YYYY-MM-DD strings (UTC date-only) to avoid TZ drift.
 */
export function sumPurchasesInRange(
  purchases: SupplementalPurchase[],
  from: Date,
  to: Date,
): number {
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  return purchases
    .filter((p) => p.date >= fromIso && p.date <= toIso)
    .reduce((sum, p) => sum + (Number.isFinite(p.amountUsd) ? p.amountUsd : 0), 0);
}

/**
 * Filter supplemental purchases to those falling in [from, to] inclusive,
 * preserving order. Useful for stacking onto a daily timeseries.
 */
export function purchasesInRange(
  purchases: SupplementalPurchase[],
  from: Date,
  to: Date,
): SupplementalPurchase[] {
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  return purchases.filter((p) => p.date >= fromIso && p.date <= toIso);
}
