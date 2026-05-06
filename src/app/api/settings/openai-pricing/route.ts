import { NextResponse } from "next/server";

import {
  getEffectivePricing,
  getOverridePricing,
  getUpstreamPricing,
  setOverridePricing,
  setUpstreamFromMdx,
  type PricingRow,
} from "@/server/openai-pricing";

const VALID_TIERS = new Set(["standard", "batch", "flex", "priority"]);
const VALID_CONTEXTS = new Set(["short", "long"]);
const VALID_CATEGORIES = new Set([
  "flagship",
  "realtime",
  "image",
  "video",
  "transcription",
  "specialized",
  "finetune",
  "embeddings",
  "moderation",
  "tools",
  "storage",
  "other",
]);

function sanitizeRow(input: unknown): PricingRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (typeof r.model !== "string" || r.model.length === 0) return null;

  const tier = typeof r.tier === "string" && VALID_TIERS.has(r.tier) ? (r.tier as PricingRow["tier"]) : "standard";
  const context =
    typeof r.context === "string" && VALID_CONTEXTS.has(r.context)
      ? (r.context as PricingRow["context"])
      : "short";
  const category =
    typeof r.category === "string" && VALID_CATEGORIES.has(r.category)
      ? (r.category as PricingRow["category"])
      : "other";

  const num = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const row: PricingRow = {
    model: r.model,
    category,
    tier,
    context,
    inputUsdPerMtok: num(r.inputUsdPerMtok),
    cachedInputUsdPerMtok: num(r.cachedInputUsdPerMtok),
    outputUsdPerMtok: num(r.outputUsdPerMtok),
  };
  if (r.notes && typeof r.notes === "string") row.notes = r.notes;
  if (r.unit && typeof r.unit === "string") row.unit = r.unit as PricingRow["unit"];
  return row;
}

export async function GET() {
  try {
    const [upstream, overrides, effective] = await Promise.all([
      getUpstreamPricing(),
      getOverridePricing(),
      getEffectivePricing(),
    ]);

    return NextResponse.json({
      parsedAt: effective.parsedAt,
      verifiedAt: effective.verifiedAt,
      status: effective.status,
      upstream: upstream
        ? {
            parsedAt: upstream.parsedAt,
            status: upstream.status,
            rows: upstream.rows,
            rawMdx: upstream.rawMdx,
            error: upstream.error,
          }
        : { parsedAt: null, status: "empty", rows: [], rawMdx: null },
      overrides: overrides ?? { verifiedAt: null, rows: [] },
      effective,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { source?: unknown; overrides?: unknown };

    let sourceResult: Awaited<ReturnType<typeof setUpstreamFromMdx>> | undefined;
    if (typeof body.source === "string" && body.source.trim().length > 0) {
      sourceResult = await setUpstreamFromMdx(body.source);
    }

    let overridesResult: Awaited<ReturnType<typeof setOverridePricing>> | undefined;
    if (Array.isArray(body.overrides)) {
      const rows = body.overrides
        .map(sanitizeRow)
        .filter((r): r is PricingRow => r !== null);
      overridesResult = await setOverridePricing(rows);
    }

    if (!sourceResult && !overridesResult) {
      return NextResponse.json(
        { error: "Provide `source` (MDX paste) and/or `overrides` (array)." },
        { status: 400 },
      );
    }

    const effective = await getEffectivePricing();

    if (sourceResult && !sourceResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          source: sourceResult,
          overrides: overridesResult,
          effective,
        },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      source: sourceResult,
      overrides: overridesResult,
      effective,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
