import { NextResponse } from "next/server";

import {
  CLAUDE_ANALYTICS_DATA_FLOOR,
  CLAUDE_ANALYTICS_LAG_DAYS,
} from "@/server/claude-sync-config";

const KNOWN_USER_USAGE_FIELDS = new Set([
  "actor",
  "product",
  "model",
  "context_window",
  "inference_geo",
  "speed",
  "uncached_input_tokens",
  "cache_creation",
  "cache_read_input_tokens",
  "output_tokens",
  "total_tokens",
  "server_tool_use",
  "requests",
]);

const KNOWN_USER_COST_FIELDS = new Set([
  "actor",
  "product",
  "model",
  "context_window",
  "inference_geo",
  "speed",
  "currency",
  "amount",
  "list_amount",
  "cost_type",
  "token_type",
  "requests",
]);

const KNOWN_BUCKET_FIELDS = new Set([
  "starting_at",
  "ending_at",
  "results",
]);

const KNOWN_BUCKET_RESULT_FIELDS = new Set([
  "product",
  "model",
  "context_window",
  "inference_geo",
  "speed",
  "uncached_input_tokens",
  "cache_creation",
  "cache_read_input_tokens",
  "output_tokens",
  "server_tool_use",
  "currency",
  "amount",
  "list_amount",
  "cost_type",
  "token_type",
]);

type ProbeStatus =
  | { ok: true; status: number; durationMs: number }
  | { ok: false; status: number; durationMs: number; error: string };

type ProbeResult = {
  endpoint: string;
  url: string;
  request: ProbeStatus;
  dataRefreshedAt?: string;
  rowCount?: number;
  hasMore?: boolean;
  sampleRow?: unknown;
  unknownFields?: string[];
  totals?: Record<string, number | string>;
};

/**
 * Probe the four new Anthropic Analytics cost+usage endpoints with a small
 * sample window and report status, sample shape, and any response fields
 * that aren't in our static type list (so we can spot beta-API drift).
 *
 * Read-only: makes no DB writes. Used by the recon card on the Claude EE
 * settings page to confirm access before enabling the full sync.
 */
export async function GET(request: Request) {
  const apiKey = process.env.CLAUDE_ANALYTICS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CLAUDE_ANALYTICS_API_KEY is not configured." },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  // Allow the caller to override the sample window for re-probing fresh dates.
  // Defaults: 7-day window ending at today - lag - 1 (the most recent fully
  // available date), starting 6 days earlier.
  const lagDays = CLAUDE_ANALYTICS_LAG_DAYS;
  const today = new Date();
  const defaultEnd = new Date(today.getTime() - (lagDays + 1) * 24 * 60 * 60 * 1000);
  const defaultStart = new Date(defaultEnd.getTime() - 6 * 24 * 60 * 60 * 1000);
  // Clamp to data floor.
  const floor = new Date(`${CLAUDE_ANALYTICS_DATA_FLOOR}T00:00:00.000Z`);
  const start = new Date(Math.max(
    (url.searchParams.get("starting_at") ? new Date(url.searchParams.get("starting_at")!) : defaultStart).getTime(),
    floor.getTime(),
  ));
  const end = url.searchParams.get("ending_at")
    ? new Date(url.searchParams.get("ending_at")!)
    : defaultEnd;

  if (end <= start) {
    return NextResponse.json(
      {
        error: `Probe window is empty: starting_at=${start.toISOString()} ending_at=${end.toISOString()}. Data floor is ${CLAUDE_ANALYTICS_DATA_FLOOR}.`,
      },
      { status: 400 },
    );
  }

  const startingAt = start.toISOString();
  const endingAt = end.toISOString();

  const probes: ProbeResult[] = [];

  probes.push(
    await probeEndpoint(apiKey, "user_usage_report", {
      starting_at: startingAt,
      ending_at: endingAt,
      limit: "5",
    }, KNOWN_USER_USAGE_FIELDS, "user_usage"),
  );
  probes.push(
    await probeEndpoint(apiKey, "user_cost_report", {
      starting_at: startingAt,
      ending_at: endingAt,
      limit: "5",
    }, KNOWN_USER_COST_FIELDS, "user_cost"),
  );
  probes.push(
    await probeEndpoint(apiKey, "usage_report", {
      starting_at: startingAt,
      ending_at: endingAt,
      bucket_width: "1d",
      limit: "5",
    }, KNOWN_BUCKET_FIELDS, "bucketed_usage", KNOWN_BUCKET_RESULT_FIELDS),
  );
  probes.push(
    await probeEndpoint(apiKey, "cost_report", {
      starting_at: startingAt,
      ending_at: endingAt,
      bucket_width: "1d",
      limit: "5",
    }, KNOWN_BUCKET_FIELDS, "bucketed_cost", KNOWN_BUCKET_RESULT_FIELDS),
  );

  return NextResponse.json({
    window: { startingAt, endingAt },
    probes,
    notes: [
      `Data floor: ${CLAUDE_ANALYTICS_DATA_FLOOR}.`,
      `Cost+usage endpoints have a typical 4-hour refresh, may take up to 24h. Values can revise for ~30 days.`,
      `Cost endpoints reflect "extra usage only" on seat-based Enterprise plans, full spend on usage-based plans.`,
    ],
  });
}

async function probeEndpoint(
  apiKey: string,
  endpoint: string,
  params: Record<string, string>,
  knownFields: Set<string>,
  shape: "user_usage" | "user_cost" | "bucketed_usage" | "bucketed_cost",
  knownResultFields?: Set<string>,
): Promise<ProbeResult> {
  const qs = new URLSearchParams(params);
  const url = `https://api.anthropic.com/v1/organizations/analytics/${endpoint}?${qs.toString()}`;
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return {
      endpoint,
      url,
      request: {
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const durationMs = Date.now() - startedAt;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave as raw text */
  }

  if (!res.ok) {
    return {
      endpoint,
      url,
      request: {
        ok: false,
        status: res.status,
        durationMs,
        error: typeof json === "object" && json !== null && "error" in json
          ? JSON.stringify((json as { error: unknown }).error)
          : text.slice(0, 500),
      },
    };
  }

  const body = json as {
    data?: unknown[];
    has_more?: boolean;
    next_page?: string | null;
    data_refreshed_at?: string;
    organization_id?: string;
  };
  const rows = Array.isArray(body?.data) ? body.data : [];
  const sampleRow = rows[0];
  const unknownFields = sampleRow && typeof sampleRow === "object"
    ? Object.keys(sampleRow as Record<string, unknown>).filter((k) => !knownFields.has(k))
    : [];

  // For bucketed endpoints, also surface unknown keys on results[].
  const unknownInner: string[] = [];
  if (knownResultFields && sampleRow && typeof sampleRow === "object" && "results" in sampleRow) {
    const results = (sampleRow as { results?: unknown[] }).results;
    if (Array.isArray(results) && results.length > 0 && typeof results[0] === "object") {
      const innerKeys = Object.keys(results[0] as Record<string, unknown>);
      for (const k of innerKeys) if (!knownResultFields.has(k)) unknownInner.push(k);
    }
  }

  const totals = summarizeTotals(rows, shape);

  return {
    endpoint,
    url,
    request: { ok: true, status: res.status, durationMs },
    dataRefreshedAt: body?.data_refreshed_at,
    rowCount: rows.length,
    hasMore: Boolean(body?.has_more),
    sampleRow,
    unknownFields: [...unknownFields, ...unknownInner.map((k) => `results[].${k}`)],
    totals,
  };
}

function parseFractionalCents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n / 100 : 0;
}

function summarizeTotals(
  rows: unknown[],
  shape: "user_usage" | "user_cost" | "bucketed_usage" | "bucketed_cost",
): Record<string, number | string> {
  const totals: Record<string, number | string> = {};
  if (rows.length === 0) return totals;

  if (shape === "user_usage") {
    let totalTokens = 0;
    const users = new Set<string>();
    for (const row of rows as Array<{ actor?: { user_id?: string }; total_tokens?: number }>) {
      totalTokens += Number(row?.total_tokens ?? 0);
      if (row?.actor?.user_id) users.add(row.actor.user_id);
    }
    totals.totalTokensInSample = totalTokens;
    totals.distinctUsersInSample = users.size;
  } else if (shape === "user_cost") {
    let totalUsd = 0;
    let totalListUsd = 0;
    const users = new Set<string>();
    for (const row of rows as Array<{
      actor?: { user_id?: string };
      amount?: string;
      list_amount?: string;
    }>) {
      totalUsd += parseFractionalCents(row?.amount);
      totalListUsd += parseFractionalCents(row?.list_amount);
      if (row?.actor?.user_id) users.add(row.actor.user_id);
    }
    totals.totalDiscountedUsd = totalUsd;
    totals.totalListUsd = totalListUsd;
    totals.distinctUsersInSample = users.size;
  } else if (shape === "bucketed_usage") {
    let totalTokens = 0;
    for (const row of rows as Array<{ results?: Array<{ uncached_input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } }> }>) {
      for (const r of row?.results ?? []) {
        totalTokens +=
          Number(r?.uncached_input_tokens ?? 0) +
          Number(r?.output_tokens ?? 0) +
          Number(r?.cache_read_input_tokens ?? 0) +
          Number(r?.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
          Number(r?.cache_creation?.ephemeral_1h_input_tokens ?? 0);
      }
    }
    totals.totalTokensInSample = totalTokens;
    totals.bucketsInSample = rows.length;
  } else if (shape === "bucketed_cost") {
    let totalUsd = 0;
    let totalListUsd = 0;
    for (const row of rows as Array<{ results?: Array<{ amount?: string; list_amount?: string }> }>) {
      for (const r of row?.results ?? []) {
        totalUsd += parseFractionalCents(r?.amount);
        totalListUsd += parseFractionalCents(r?.list_amount);
      }
    }
    totals.totalDiscountedUsd = totalUsd;
    totals.totalListUsd = totalListUsd;
    totals.bucketsInSample = rows.length;
  }

  return totals;
}
