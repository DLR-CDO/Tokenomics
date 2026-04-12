import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { billingCycles, connectorRuns, dimMember, usageFacts } from "@/db/schema";

import {
  createCursorClient,
  type CursorClient,
  type DailyUsage,
  type FilteredUsageEvent,
  type GroupsResponse,
} from "./cursor-client";
import { CURSOR_ANALYTICS_RANGE_ATTEMPTS, getCursorAnalyticsRangeOverride, getCursorSyncLookbackStartMs } from "./cursor-sync-config";
import { getIncrementalStart } from "./sync-utils";

type MetricKind =
  | "tokens_in"
  | "tokens_out"
  | "requests"
  | "cost_usd"
  | "dau"
  | "wau"
  | "lines_added"
  | "lines_deleted"
  | "tabs_shown"
  | "tabs_accepted"
  | "tabs_rejected"
  | "agent_edits_accepted"
  | "agent_edits_rejected";

function dayStartIso(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function hashExternalId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

/** Cursor rejects ranges over 30 days; use 25 calendar-style days in ms to stay under inclusive limits. */
const CURSOR_API_MAX_RANGE_MS = 25 * 24 * 60 * 60 * 1000;

async function upsertMemberRow(
  userId: string,
  email: string,
  displayName: string | null,
  role?: string | null,
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(dimMember)
    .values({
      sourceSystem: "cursor",
      externalKey: userId,
      displayName: displayName ?? email,
      email,
      role: role ?? null,
    })
    .onConflictDoUpdate({
      target: [dimMember.sourceSystem, dimMember.externalKey],
      set: {
        displayName: displayName ?? email,
        email,
        role: role ?? sql`dim_member.role`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: dimMember.id });

  if (!row) {
    const [found] = await db
      .select({ id: dimMember.id })
      .from(dimMember)
      .where(and(eq(dimMember.sourceSystem, "cursor"), eq(dimMember.externalKey, userId)))
      .limit(1);
    if (!found) throw new Error("Failed to upsert dim_member");
    return found.id;
  }
  return row.id;
}

async function upsertFact(input: {
  occurredAt: Date;
  metricKind: MetricKind;
  amount: number;
  memberId: string | null;
  modelName: string | null;
  dimensionsJson?: Record<string, unknown>;
  externalId: string;
  billingGroupId?: string | null;
  billingGroupName?: string | null;
}) {
  const db = getDb();
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
      billingGroupId: input.billingGroupId ?? null,
      billingGroupName: input.billingGroupName ?? null,
      dimensionsJson: input.dimensionsJson ?? null,
      externalId: input.externalId,
    })
    .onConflictDoUpdate({
      target: [usageFacts.sourceSystem, usageFacts.externalId],
      set: {
        amount: sql`excluded.amount`,
        occurredAt: sql`excluded.occurred_at`,
        memberId: sql`excluded.member_id`,
        modelName: sql`excluded.model_name`,
        billingGroupId: sql`excluded.billing_group_id`,
        billingGroupName: sql`excluded.billing_group_name`,
        dimensionsJson: sql`excluded.dimensions_json`,
        ingestedAt: sql`now()`,
      },
    });
}

async function syncMembersAndMap(): Promise<Map<string, string>> {
  const client = createCursorClient();
  const members = await client.getTeamMembers();
  const map = new Map<string, string>();
  for (const m of members) {
    if (m.isRemoved) continue;
    const id = await upsertMemberRow(m.id, m.email, m.name, m.role);
    map.set(m.id, id);
    map.set(m.email.toLowerCase(), id);
  }
  return map;
}

async function syncBillingCycleFromGroups(): Promise<void> {
  const client = createCursorClient();
  const db = getDb();
  const groups = await client.getBillingGroups();
  const bc = groups.billingCycle;
  if (!bc?.cycleStart || !bc?.cycleEnd) return;

  await db.delete(billingCycles).where(eq(billingCycles.sourceSystem, "cursor"));
  await db.insert(billingCycles).values({
    sourceSystem: "cursor",
    label: "Current (from Cursor)",
    cycleStart: new Date(bc.cycleStart),
    cycleEnd: new Date(bc.cycleEnd),
    timezone: "UTC",
  });
}

async function syncDailySpendFromGroups(membersByUserId: Map<string, string>): Promise<number> {
  const client = createCursorClient();
  const data: GroupsResponse = await client.getBillingGroups();
  const allGroups = [...(data.groups ?? []), data.unassignedGroup].filter(
    (g): g is NonNullable<typeof g> => g != null && typeof g === "object",
  );
  let n = 0;

  for (const group of allGroups) {
    const groupMembers = group.currentMembers ?? [];
    for (const m of groupMembers) {
      const memberId = membersByUserId.get(m.userId) ?? membersByUserId.get(m.email.toLowerCase()) ?? null;
      for (const d of m.dailySpend ?? []) {
        const externalId = `cursor:daily_spend:${d.date}:${m.userId}`;
        await upsertFact({
          occurredAt: dayStartIso(d.date),
          metricKind: "cost_usd",
          amount: d.spendCents / 100,
          memberId,
          modelName: null,
          billingGroupId: group.id ?? null,
          billingGroupName: group.name ?? null,
          dimensionsJson: { source: "billing_groups", groupId: group.id, groupName: group.name },
          externalId,
        });
        n += 1;
      }
    }
  }

  return n;
}

async function syncSpending(membersByUserId: Map<string, string>, cycleStart: string): Promise<void> {
  const client = createCursorClient();
  const { members } = await client.getSpending();
  const cycleKey = cycleStart.replaceAll("-", "");

  for (const m of members) {
    const memberId = membersByUserId.get(m.userId) ?? membersByUserId.get(m.email.toLowerCase());
    const externalId = `cursor:spend:cycle:${cycleKey}:${m.userId}`;
    const amountUsd = m.spendCents / 100;
    await upsertFact({
      occurredAt: dayStartIso(cycleStart),
      metricKind: "cost_usd",
      amount: amountUsd,
      memberId: memberId ?? null,
      modelName: null,
      dimensionsJson: {
        includedSpendCents: m.includedSpendCents,
        fastPremiumRequests: m.fastPremiumRequests,
      },
      externalId,
    });
  }
}

async function syncDailyUsage(membersByUserId: Map<string, string>, rangeStartMs: number): Promise<number> {
  const client = createCursorClient();
  const now = Date.now();
  const rangeStart = rangeStartMs;
  let count = 0;

  let chunkStart = rangeStart;
  const allRows: DailyUsage[] = [];
  while (chunkStart < now) {
    const chunkEnd = Math.min(chunkStart + CURSOR_API_MAX_RANGE_MS, now);
    const chunk = await client.getDailyUsage({ pageSize: 100, startDate: chunkStart, endDate: chunkEnd });
    allRows.push(...chunk);
    chunkStart = chunkEnd + 1;
  }

  for (const row of allRows) {
    const memberId = membersByUserId.get(row.userId) ?? membersByUserId.get(row.email.toLowerCase()) ?? null;
    const day = row.date;
    const base = `cursor:daily:${day}:${row.userId}`;

    const sharedDim = {
      clientVersion: row.clientVersion || undefined,
      tabMostUsedExtension: row.tabMostUsedExtension || undefined,
    };

    const metrics: Array<{ kind: MetricKind; amount: number; ext: string; dim?: Record<string, unknown> }> = [
      { kind: "lines_added", amount: row.linesAdded, ext: `${base}:lines_added` },
      { kind: "lines_deleted", amount: row.linesDeleted, ext: `${base}:lines_deleted` },
      { kind: "requests", amount: row.chatRequests, ext: `${base}:chat_requests`, dim: { subtype: "chat", ...sharedDim } },
      { kind: "requests", amount: row.agentRequests, ext: `${base}:agent_requests`, dim: { subtype: "agent", ...sharedDim } },
      { kind: "requests", amount: row.composerRequests, ext: `${base}:composer_requests`, dim: { subtype: "composer", ...sharedDim } },
      { kind: "requests", amount: row.usageBasedReqs, ext: `${base}:usage_based_requests`, dim: { subtype: "usage_based", ...sharedDim } },
      { kind: "tabs_shown", amount: row.totalTabsShown, ext: `${base}:tabs_shown` },
      { kind: "tabs_accepted", amount: row.tabsAccepted, ext: `${base}:tabs_accepted` },
      { kind: "agent_edits_accepted", amount: row.totalAccepts, ext: `${base}:accepts` },
      { kind: "agent_edits_rejected", amount: row.totalRejects, ext: `${base}:rejects` },
    ];

    for (const m of metrics) {
      if (m.amount === 0 && m.kind !== "lines_added") continue;
      await upsertFact({
        occurredAt: dayStartIso(day),
        metricKind: m.kind,
        amount: m.amount,
        memberId,
        modelName: row.mostUsedModel || null,
        dimensionsJson: m.dim,
        externalId: m.ext,
      });
      count += 1;
    }
  }

  return count;
}

async function syncUsageEvents(membersByEmail: Map<string, string>, startDateMs: number): Promise<number> {
  const client = createCursorClient();
  const now = Date.now();
  let total = 0;

  let chunkStart = startDateMs;
  while (chunkStart < now) {
    const chunkEnd = Math.min(chunkStart + CURSOR_API_MAX_RANGE_MS, now);
    let page = 1;
    while (true) {
      const { usageEvents, pagination } = await client.getFilteredUsageEvents({
        startDate: chunkStart,
        endDate: chunkEnd,
        page,
        pageSize: 500,
      });

      for (const ev of usageEvents) {
        total += await upsertUsageEvent(ev, membersByEmail);
      }

      if (!pagination.hasNextPage) break;
      page += 1;
    }
    chunkStart = chunkEnd + 1;
  }

  return total;
}

async function upsertUsageEvent(ev: FilteredUsageEvent, membersByEmail: Map<string, string>): Promise<number> {
  const emailKey = ev.userEmail.toLowerCase();
  const memberId = membersByEmail.get(emailKey) ?? null;
  const ts = new Date(ev.timestamp);
  if (Number.isNaN(ts.getTime())) return 0;

  const extBase = hashExternalId([
    "evt",
    ev.timestamp,
    ev.userEmail,
    ev.model,
    ev.kind,
    String(ev.tokenUsage?.inputTokens ?? ""),
    String(ev.tokenUsage?.outputTokens ?? ""),
    String(ev.tokenUsage?.totalCents ?? ""),
  ]);

  let n = 0;
  if (ev.tokenUsage) {
    if (ev.tokenUsage.inputTokens > 0) {
      await upsertFact({
        occurredAt: ts,
        metricKind: "tokens_in",
        amount: ev.tokenUsage.inputTokens,
        memberId,
        modelName: ev.model || null,
        dimensionsJson: { kind: ev.kind, maxMode: ev.maxMode },
        externalId: `cursor:${extBase}:in`,
      });
      n += 1;
    }
    if (ev.tokenUsage.outputTokens > 0) {
      await upsertFact({
        occurredAt: ts,
        metricKind: "tokens_out",
        amount: ev.tokenUsage.outputTokens,
        memberId,
        modelName: ev.model || null,
        dimensionsJson: { kind: ev.kind, maxMode: ev.maxMode },
        externalId: `cursor:${extBase}:out`,
      });
      n += 1;
    }
  }

  return n;
}

async function resolveAnalyticsRange(client: CursorClient): Promise<string> {
  const override = getCursorAnalyticsRangeOverride();
  if (override) return override;
  for (const r of CURSOR_ANALYTICS_RANGE_ATTEMPTS) {
    try {
      await client.getAnalyticsDAU({ startDate: r, endDate: "today" });
      return r;
    } catch {
      continue;
    }
  }
  return "30d";
}

async function syncAnalytics(client: CursorClient, range: string): Promise<number> {
  let count = 0;

  const dau = await client.getAnalyticsDAU({ startDate: range, endDate: "today" });
  for (const row of dau) {
    const day = row.date;
    await upsertFact({
      occurredAt: dayStartIso(day),
      metricKind: "dau",
      amount: row.dau,
      memberId: null,
      modelName: null,
      dimensionsJson: { cli_dau: row.cli_dau, cloud_agent_dau: row.cloud_agent_dau, bugbot_dau: row.bugbot_dau },
      externalId: `cursor:dau:${day}`,
    });
    count += 1;
  }

  const models = await client.getAnalyticsModelUsage({ startDate: range, endDate: "today" });
  for (const row of models) {
    const day = row.date;
    for (const [model, stats] of Object.entries(row.model_breakdown ?? {})) {
      await upsertFact({
        occurredAt: dayStartIso(day),
        metricKind: "requests",
        amount: stats.messages,
        memberId: null,
        modelName: model,
        dimensionsJson: { subtype: "model_messages", users: stats.users },
        externalId: `cursor:modelusage:${day}:${hashExternalId([day, model])}`,
      });
      count += 1;
    }
  }

  const agentEdits = await client.getAnalyticsAgentEdits({ startDate: range, endDate: "today" });
  for (let rowIdx = 0; rowIdx < agentEdits.length; rowIdx += 1) {
    const row = agentEdits[rowIdx]!;
    const day = row.event_date;
    const fields: Array<[string, number]> = [
      ["total_suggested_diffs", row.total_suggested_diffs ?? 0],
      ["total_accepted_diffs", row.total_accepted_diffs ?? 0],
      ["total_rejected_diffs", row.total_rejected_diffs ?? 0],
      ["total_lines_accepted", row.total_lines_accepted ?? 0],
      ["total_lines_suggested", row.total_lines_suggested ?? 0],
    ];
    for (const [field, amount] of fields) {
      if (amount === 0) continue;
      await upsertFact({
        occurredAt: dayStartIso(day),
        metricKind: "requests",
        amount,
        memberId: null,
        modelName: null,
        dimensionsJson: { cursor_analytics: "agent_edits", field },
        externalId: `cursor:analytics:agent_edits:${day}:${rowIdx}:${field}`,
      });
      count += 1;
    }
  }

  const tabs = await client.getAnalyticsTabs({ startDate: range, endDate: "today" });
  for (let rowIdx = 0; rowIdx < tabs.length; rowIdx += 1) {
    const row = tabs[rowIdx]!;
    const day = row.event_date;
    const pairs: Array<[string, number]> = [
      ["total_suggestions", row.total_suggestions ?? 0],
      ["total_accepts", row.total_accepts ?? 0],
      ["total_rejects", row.total_rejects ?? 0],
    ];
    for (const [field, amount] of pairs) {
      if (amount === 0) continue;
      await upsertFact({
        occurredAt: dayStartIso(day),
        metricKind: "requests",
        amount,
        memberId: null,
        modelName: null,
        dimensionsJson: { cursor_analytics: "tabs", field },
        externalId: `cursor:analytics:tabs:${day}:${rowIdx}:${field}`,
      });
      count += 1;
    }
  }

  const mcp = await client.getAnalyticsMCP({ startDate: range, endDate: "today" });
  for (const row of mcp) {
    const day = row.event_date;
    const ext = hashExternalId([day, row.tool_name, row.mcp_server_name]);
    await upsertFact({
      occurredAt: dayStartIso(day),
      metricKind: "requests",
      amount: row.usage,
      memberId: null,
      modelName: null,
      dimensionsJson: { cursor_analytics: "mcp", tool_name: row.tool_name, mcp_server_name: row.mcp_server_name },
      externalId: `cursor:analytics:mcp:${ext}`,
    });
    count += 1;
  }

  const commands = await client.getAnalyticsCommands({ startDate: range, endDate: "today" });
  for (const row of commands) {
    const day = row.event_date;
    const ext = hashExternalId([day, row.command_name]);
    await upsertFact({
      occurredAt: dayStartIso(day),
      metricKind: "requests",
      amount: row.usage,
      memberId: null,
      modelName: null,
      dimensionsJson: { cursor_analytics: "commands", command_name: row.command_name },
      externalId: `cursor:analytics:cmd:${ext}`,
    });
    count += 1;
  }

  const plans = await client.getAnalyticsPlans({ startDate: range, endDate: "today" });
  for (const row of plans) {
    const day = row.event_date;
    const ext = hashExternalId([day, row.model]);
    await upsertFact({
      occurredAt: dayStartIso(day),
      metricKind: "requests",
      amount: row.usage,
      memberId: null,
      modelName: row.model,
      dimensionsJson: { cursor_analytics: "plans" },
      externalId: `cursor:analytics:plans:${ext}`,
    });
    count += 1;
  }

  const extensions = await client.getAnalyticsFileExtensions({ startDate: range, endDate: "today" });
  for (const row of extensions) {
    const day = row.event_date;
    const ext = hashExternalId([day, row.file_extension]);
    const amount = row.total_files ?? row.total_accepts ?? row.total_rejects ?? 0;
    if (amount === 0) continue;
    await upsertFact({
      occurredAt: dayStartIso(day),
      metricKind: "requests",
      amount,
      memberId: null,
      modelName: null,
      dimensionsJson: {
        cursor_analytics: "file_extensions",
        file_extension: row.file_extension,
        total_accepts: row.total_accepts,
        total_rejects: row.total_rejects,
      },
      externalId: `cursor:analytics:ext:${ext}`,
    });
    count += 1;
  }

  const versions = await client.getAnalyticsClientVersions({ startDate: range, endDate: "today" });
  for (const row of versions) {
    const day = row.event_date;
    const ext = hashExternalId([day, row.client_version]);
    await upsertFact({
      occurredAt: dayStartIso(day),
      metricKind: "requests",
      amount: row.user_count,
      memberId: null,
      modelName: null,
      dimensionsJson: { cursor_analytics: "client_versions", client_version: row.client_version, percentage: row.percentage },
      externalId: `cursor:analytics:ver:${ext}`,
    });
    count += 1;
  }

  let page = 1;
  while (true) {
    const batch = await client.getAICodeCommits({ startDate: range, endDate: "today", page, pageSize: 500 });
    if (batch.items.length === 0) break;
    for (const c of batch.items) {
      const ts = new Date(c.commitTs);
      if (!Number.isNaN(ts.getTime())) {
        await upsertFact({
          occurredAt: ts,
          metricKind: "lines_added",
          amount: c.totalLinesAdded,
          memberId: null,
          modelName: null,
          dimensionsJson: {
            cursor_analytics: "ai_code_commit",
            repo: c.repoName,
            lines_deleted: c.totalLinesDeleted,
            user_email: c.userEmail,
          },
          externalId: `cursor:ai_commit:${c.commitHash}:add`,
        });
        count += 1;
        if (c.totalLinesDeleted > 0) {
          await upsertFact({
            occurredAt: ts,
            metricKind: "lines_added",
            amount: c.totalLinesDeleted,
            memberId: null,
            modelName: null,
            dimensionsJson: { cursor_analytics: "ai_code_commit", repo: c.repoName, user_email: c.userEmail, kind: "deleted" },
            externalId: `cursor:ai_commit:${c.commitHash}:del`,
          });
          count += 1;
        }
      }
    }
    if (batch.items.length < 500) break;
    page += 1;
  }

  return count;
}

export interface CursorSyncResult {
  rowsUpserted: number;
  cycleStart?: string;
  analyticsRange?: string;
  lookbackDays?: number;
  errors: string[];
}

export async function syncCursorData(): Promise<CursorSyncResult> {
  const db = getDb();
  const errors: string[] = [];
  let rows = 0;

  const [run] = await db
    .insert(connectorRuns)
    .values({
      sourceSystem: "cursor",
      connectorName: "cursor",
      status: "running",
    })
    .returning({ id: connectorRuns.id });

  const runId = run?.id;

  try {
    const membersMap = await syncMembersAndMap();
    rows += membersMap.size;

    await syncBillingCycleFromGroups();
    rows += await syncDailySpendFromGroups(membersMap);

    const spendClient = createCursorClient();
    const { members: spendMembers, cycleStart } = await spendClient.getSpending();
    rows += spendMembers.length;
    await syncSpending(membersMap, cycleStart || new Date().toISOString().slice(0, 10));

    const fullLookbackMs = getCursorSyncLookbackStartMs();
    const { startMs, isIncremental } = await getIncrementalStart("cursor", fullLookbackMs);

    rows += await syncDailyUsage(membersMap, startMs);
    rows += await syncUsageEvents(membersMap, startMs);

    const analyticsClient = createCursorClient();
    const analyticsRange = await resolveAnalyticsRange(analyticsClient);
    rows += await syncAnalytics(analyticsClient, analyticsRange);

    const lookbackDays = Math.round((Date.now() - startMs) / (24 * 60 * 60 * 1000));

    if (runId) {
      await db
        .update(connectorRuns)
        .set({
          status: "success",
          finishedAt: new Date(),
          rowsUpserted: rows,
          watermarkAt: new Date(),
          metadataJson: { analyticsRange, lookbackDays, isIncremental },
        })
        .where(eq(connectorRuns.id, runId));
    }

    return { rowsUpserted: rows, cycleStart, analyticsRange, lookbackDays, errors };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    if (runId) {
      await db
        .update(connectorRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: msg,
        })
        .where(eq(connectorRuns.id, runId));
    }
    return { rowsUpserted: rows, errors };
  }
}

export async function syncCursorFromEnv(): Promise<CursorSyncResult> {
  return syncCursorData();
}
