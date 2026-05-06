import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { sourceSystemSchema } from "@/lib/filters";
import {
  readSupplementalPurchases,
  supplementalPurchaseSchema,
  writeSupplementalPurchases,
  type SupplementalPurchase,
} from "@/lib/supplemental-purchases";

const inboundPurchaseSchema = supplementalPurchaseSchema.partial({ id: true }).extend({
  date: supplementalPurchaseSchema.shape.date,
  amountUsd: supplementalPurchaseSchema.shape.amountUsd,
});

const putBodySchema = z.object({
  purchases: z.array(inboundPurchaseSchema),
});

function resolveSource(searchParams: URLSearchParams): string {
  const raw = searchParams.get("source") ?? "claude_enterprise";
  const parsed = sourceSystemSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unsupported source: ${raw}`);
  }
  return parsed.data;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const source = resolveSource(url.searchParams);
    const purchases = await readSupplementalPurchases(source);
    return NextResponse.json({ source, purchases });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const source = resolveSource(url.searchParams);
    const body = (await request.json()) as unknown;
    const parsed = putBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const purchases: SupplementalPurchase[] = parsed.data.purchases.map((p) => ({
      id: p.id ?? randomUUID(),
      date: p.date,
      amountUsd: p.amountUsd,
      ...(p.note ? { note: p.note } : {}),
    }));
    purchases.sort((a, b) => a.date.localeCompare(b.date));
    await writeSupplementalPurchases(source, purchases);
    return NextResponse.json({ source, purchases });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({ error: "Database is not configured (set DATABASE_URL)." }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
