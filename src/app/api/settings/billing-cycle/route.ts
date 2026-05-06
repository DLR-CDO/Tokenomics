import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { billingCycles, dashboardSettings } from "@/db/schema";
import { getBillingWindowAtOffset } from "@/server/billing-window";

interface SeatConfigShape {
  billingResetDay?: number;
}

interface CycleResponse {
  source: string;
  available: boolean;
  start?: string;
  end?: string;
  label?: string;
  offset?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

/**
 * Map platform slug used by the URL / top-nav (e.g. "openai-enterprise") to
 * the canonical sourceSystem value used by storage tables (e.g. "openai_enterprise").
 */
function platformToSource(platform: string): string {
  return platform.replace(/-/g, "_");
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(0, n);
}

async function readSeatBillingDay(source: string): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, `seat_config_${source}`))
    .limit(1);
  if (!row) return null;
  const cfg = row.value as unknown as SeatConfigShape;
  if (!cfg?.billingResetDay) return null;
  const day = Math.max(1, Math.min(31, Math.floor(cfg.billingResetDay)));
  return day;
}

async function readCursorCycleAtOffset(offset: number): Promise<CycleResponse | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(billingCycles)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- enum cast matches getActiveBillingCycle
    .where(eq(billingCycles.sourceSystem, "cursor" as any))
    .orderBy(desc(billingCycles.cycleStart))
    .limit(1)
    .offset(Math.abs(offset));
  const row = rows[0];
  if (!row) return null;
  return {
    source: "cursor",
    available: true,
    start: toIsoDate(new Date(row.cycleStart)),
    end: toIsoDate(new Date(row.cycleEnd)),
    label: row.label ?? undefined,
    offset,
    hasNext: offset < 0,
    hasPrev: true,
  };
}

export async function GET(request: Request): Promise<NextResponse<CycleResponse>> {
  const { searchParams } = new URL(request.url);
  const platform = (searchParams.get("source") ?? "global").trim().toLowerCase();
  const source = platformToSource(platform);
  const offset = parseOffset(searchParams.get("offset"));
  const now = new Date();

  try {
    if (platform === "global") {
      // Global pages don't have a single concrete cycle; return a stable
      // 30-day window for display only and let per-app server resolution
      // honour `cycleOffset` when generating the executive cards.
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
      return NextResponse.json({
        source: "global",
        available: true,
        start: toIsoDate(start),
        end: toIsoDate(end),
        label: "Per-app billing cycles",
        offset,
        hasNext: offset < 0,
        hasPrev: true,
      });
    }

    if (platform === "cursor") {
      const cycle = await readCursorCycleAtOffset(offset);
      if (cycle) return NextResponse.json(cycle);
      // Fall through to seat_config fallback if cursor sync hasn't populated billing_cycles yet.
      const day = await readSeatBillingDay("cursor");
      if (day !== null) {
        const { start, end } = getBillingWindowAtOffset(day, now, offset);
        return NextResponse.json({
          source: "cursor",
          available: true,
          start: toIsoDate(start),
          end: toIsoDate(end),
          offset,
          hasNext: offset < 0,
          hasPrev: true,
        });
      }
      return NextResponse.json({ source: "cursor", available: false, offset });
    }

    if (platform === "openai-enterprise" || platform === "openai-api" || platform === "openai" || platform === "azure") {
      const billingSource = platform === "openai-api" || platform === "openai" ? "openai_enterprise" : source;
      const day = await readSeatBillingDay(billingSource);
      if (day === null) {
        return NextResponse.json({ source: platform, available: false, offset });
      }
      const { start, end } = getBillingWindowAtOffset(day, now, offset);
      return NextResponse.json({
        source: platform,
        available: true,
        start: toIsoDate(start),
        end: toIsoDate(end),
        offset,
        hasNext: offset < 0,
        hasPrev: true,
      });
    }

    return NextResponse.json({ source: platform, available: false, offset });
  } catch {
    return NextResponse.json({ source: platform, available: false, offset });
  }
}
