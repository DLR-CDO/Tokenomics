import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { connectorRuns, dimMember, usageFacts } from "@/db/schema";

import {
  createOpenAIClient,
  type AudioSpeechesResultItem,
  type AudioTranscriptionsResultItem,
  type CodeInterpreterSessionsResultItem,
  type CompletionsResultItem,
  type CostsBucket,
  type EmbeddingsResultItem,
  type ImagesResultItem,
  type ModerationsResultItem,
  type OrgProject,
  type UsageBucket,
  type VectorStoresResultItem,
} from "./openai-client";
import { getOpenAISyncLookbackStartMs } from "./openai-sync-config";
import { getIncrementalStart } from "./sync-utils";

type MetricKind = "tokens_in" | "tokens_out" | "requests" | "cost_usd";

function epochToIsoDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function dayStartFromEpoch(epoch: number): Date {
  const iso = epochToIsoDate(epoch);
  return new Date(`${iso}T00:00:00.000Z`);
}

/* ---------- dim_member upsert ---------- */

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
      sourceSystem: "openai",
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
      .where(and(eq(dimMember.sourceSystem, "openai"), eq(dimMember.externalKey, userId)))
      .limit(1);
    if (!found) throw new Error("Failed to upsert dim_member for OpenAI user");
    return found.id;
  }
  return row.id;
}

/* ---------- usage_facts upsert ---------- */

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
      sourceSystem: "openai",
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

/* ---------- Sub-syncs ---------- */

async function syncUsers(projectIds: string[]): Promise<Map<string, string>> {
  const client = createOpenAIClient();
  const map = new Map<string, string>();

  // Org-level users (admins/owners)
  const orgUsers = await client.listUsers();
  for (const u of orgUsers) {
    const id = await upsertMemberRow(u.id, u.email, u.name, u.role);
    map.set(u.id, id);
    map.set(u.email.toLowerCase(), id);
  }

  // Project-level users (may overlap with org users, upsert handles dedup)
  for (const projectId of projectIds) {
    try {
      const projectUsers = await client.listProjectUsers(projectId);
      for (const u of projectUsers) {
        if (map.has(u.id)) continue;
        const id = await upsertMemberRow(u.id, u.email, u.name, u.role);
        map.set(u.id, id);
        map.set(u.email.toLowerCase(), id);
      }
    } catch {
      // Some projects may not allow listing users; skip gracefully
    }
  }

  return map;
}

async function syncProjects(): Promise<Map<string, string>> {
  const client = createOpenAIClient();
  const projects = await client.listProjects();
  const map = new Map<string, string>();
  for (const p of projects) {
    map.set(p.id, p.name);
  }
  return map;
}

async function syncCosts(
  projectNames: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  const buckets: CostsBucket[] = await client.getCosts({
    startTime: lookbackStartSec,
    endTime: nowSec,
    groupBy: ["project_id", "line_item"],
  });

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (result.object === "organization.costs.result" && result.amount) {
        const amountUsd = result.amount.value;
        if (amountUsd === 0) continue;

        const projectId = result.project_id ?? "none";
        const lineItem = result.line_item ?? "total";
        const projectName = projectNames.get(projectId) ?? null;

        await upsertFact({
          occurredAt,
          metricKind: "cost_usd",
          amount: amountUsd,
          memberId: null,
          modelName: null,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: {
            source: "openai_costs",
            lineItem,
            projectId: result.project_id,
          },
          externalId: `openai:cost:${day}:${projectId}:${lineItem}`,
        });
        count += 1;
      }
    }
  }

  return count;
}

async function syncCompletionsUsage(
  projectNames: Map<string, string>,
  userMap: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  const buckets: UsageBucket<CompletionsResultItem>[] = await client.getCompletionsUsage({
    startTime: lookbackStartSec,
    endTime: nowSec,
    groupBy: ["model", "project_id", "user_id"],
  });

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      const model = result.model ?? "unknown";
      const projectId = result.project_id ?? "none";
      const userId = result.user_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;
      const memberId = (result.user_id ? userMap.get(result.user_id) : null) ?? null;

      const sharedDim: Record<string, unknown> = {
        cached_tokens: result.input_cached_tokens ?? 0,
        audio_in: result.input_audio_tokens ?? 0,
        audio_out: result.output_audio_tokens ?? 0,
        projectId: result.project_id,
        userId: result.user_id,
      };

      const metrics: Array<{ kind: MetricKind; amount: number; suffix: string }> = [
        { kind: "tokens_in", amount: result.input_tokens, suffix: "tokens_in" },
        { kind: "tokens_out", amount: result.output_tokens, suffix: "tokens_out" },
        { kind: "requests", amount: result.num_model_requests, suffix: "requests" },
      ];

      for (const m of metrics) {
        if (m.amount === 0) continue;
        await upsertFact({
          occurredAt,
          metricKind: m.kind,
          amount: m.amount,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: sharedDim,
          externalId: `openai:completions:${day}:${model}:${projectId}:${userId}:${m.suffix}`,
        });
        count += 1;
      }
    }
  }

  return count;
}

async function syncEmbeddingsUsage(
  projectNames: Map<string, string>,
  userMap: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<EmbeddingsResultItem>[];
  try {
    buckets = await client.getEmbeddingsUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["model", "project_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      const model = result.model ?? "unknown";
      const projectId = result.project_id ?? "none";
      const userId = result.user_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;
      const memberId = (result.user_id ? userMap.get(result.user_id) : null) ?? null;

      if (result.input_tokens > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "tokens_in",
          amount: result.input_tokens,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { projectId: result.project_id, userId: result.user_id, endpoint: "embeddings" },
          externalId: `openai:embeddings:${day}:${model}:${projectId}:${userId}:tokens_in`,
        });
        count += 1;
      }

      if (result.num_model_requests > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "requests",
          amount: result.num_model_requests,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { projectId: result.project_id, userId: result.user_id, endpoint: "embeddings" },
          externalId: `openai:embeddings:${day}:${model}:${projectId}:${userId}:requests`,
        });
        count += 1;
      }
    }
  }

  return count;
}

/* ---------- Images ---------- */

async function syncImagesUsage(
  projectNames: Map<string, string>,
  userMap: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<ImagesResultItem>[];
  try {
    buckets = await client.getImagesUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["model", "project_id", "user_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (result.images === 0 && result.num_model_requests === 0) continue;
      const model = result.model ?? "unknown";
      const projectId = result.project_id ?? "none";
      const userId = result.user_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;
      const memberId = (result.user_id ? userMap.get(result.user_id) : null) ?? null;

      if (result.num_model_requests > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "requests",
          amount: result.num_model_requests,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { endpoint: "images", images: result.images, size: result.size, source: result.source },
          externalId: `openai:images:${day}:${model}:${projectId}:${userId}:requests`,
        });
        count += 1;
      }
    }
  }
  return count;
}

/* ---------- Audio Speeches (TTS) ---------- */

async function syncAudioSpeechesUsage(
  projectNames: Map<string, string>,
  userMap: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<AudioSpeechesResultItem>[];
  try {
    buckets = await client.getAudioSpeechesUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["model", "project_id", "user_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (result.characters === 0 && result.num_model_requests === 0) continue;
      const model = result.model ?? "unknown";
      const projectId = result.project_id ?? "none";
      const userId = result.user_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;
      const memberId = (result.user_id ? userMap.get(result.user_id) : null) ?? null;

      if (result.num_model_requests > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "requests",
          amount: result.num_model_requests,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { endpoint: "audio_speeches", characters: result.characters },
          externalId: `openai:audio_speeches:${day}:${model}:${projectId}:${userId}:requests`,
        });
        count += 1;
      }
    }
  }
  return count;
}

/* ---------- Audio Transcriptions (Whisper) ---------- */

async function syncAudioTranscriptionsUsage(
  projectNames: Map<string, string>,
  userMap: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<AudioTranscriptionsResultItem>[];
  try {
    buckets = await client.getAudioTranscriptionsUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["model", "project_id", "user_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (result.seconds === 0 && result.num_model_requests === 0) continue;
      const model = result.model ?? "unknown";
      const projectId = result.project_id ?? "none";
      const userId = result.user_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;
      const memberId = (result.user_id ? userMap.get(result.user_id) : null) ?? null;

      if (result.num_model_requests > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "requests",
          amount: result.num_model_requests,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { endpoint: "audio_transcriptions", seconds: result.seconds },
          externalId: `openai:audio_transcriptions:${day}:${model}:${projectId}:${userId}:requests`,
        });
        count += 1;
      }
    }
  }
  return count;
}

/* ---------- Moderations ---------- */

async function syncModerationsUsage(
  projectNames: Map<string, string>,
  userMap: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<ModerationsResultItem>[];
  try {
    buckets = await client.getModerationsUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["model", "project_id", "user_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (result.input_tokens === 0 && result.num_model_requests === 0) continue;
      const model = result.model ?? "unknown";
      const projectId = result.project_id ?? "none";
      const userId = result.user_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;
      const memberId = (result.user_id ? userMap.get(result.user_id) : null) ?? null;

      if (result.input_tokens > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "tokens_in",
          amount: result.input_tokens,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { endpoint: "moderations" },
          externalId: `openai:moderations:${day}:${model}:${projectId}:${userId}:tokens_in`,
        });
        count += 1;
      }

      if (result.num_model_requests > 0) {
        await upsertFact({
          occurredAt,
          metricKind: "requests",
          amount: result.num_model_requests,
          memberId,
          modelName: model,
          billingGroupId: result.project_id ?? null,
          billingGroupName: projectName,
          dimensionsJson: { endpoint: "moderations" },
          externalId: `openai:moderations:${day}:${model}:${projectId}:${userId}:requests`,
        });
        count += 1;
      }
    }
  }
  return count;
}

/* ---------- Vector Stores ---------- */

async function syncVectorStoresUsage(
  projectNames: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<VectorStoresResultItem>[];
  try {
    buckets = await client.getVectorStoresUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["project_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (result.usage_bytes === 0) continue;
      const projectId = result.project_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;

      await upsertFact({
        occurredAt,
        metricKind: "requests",
        amount: result.usage_bytes,
        memberId: null,
        modelName: null,
        billingGroupId: result.project_id ?? null,
        billingGroupName: projectName,
        dimensionsJson: { endpoint: "vector_stores", usage_bytes: result.usage_bytes },
        externalId: `openai:vector_stores:${day}:${projectId}:bytes`,
      });
      count += 1;
    }
  }
  return count;
}

/* ---------- Code Interpreter Sessions ---------- */

async function syncCodeInterpreterUsage(
  projectNames: Map<string, string>,
  lookbackStartSec: number,
): Promise<number> {
  const client = createOpenAIClient();
  const nowSec = Math.floor(Date.now() / 1000);
  let count = 0;

  let buckets: UsageBucket<CodeInterpreterSessionsResultItem>[];
  try {
    buckets = await client.getCodeInterpreterSessionsUsage({
      startTime: lookbackStartSec,
      endTime: nowSec,
      groupBy: ["project_id"],
    });
  } catch {
    return 0;
  }

  for (const bucket of buckets) {
    const day = epochToIsoDate(bucket.start_time);
    const occurredAt = dayStartFromEpoch(bucket.start_time);

    for (const result of bucket.results) {
      if (!result.num_sessions || result.num_sessions === 0) continue;
      const projectId = result.project_id ?? "none";
      const projectName = projectNames.get(projectId) ?? null;

      await upsertFact({
        occurredAt,
        metricKind: "requests",
        amount: result.num_sessions,
        memberId: null,
        modelName: null,
        billingGroupId: result.project_id ?? null,
        billingGroupName: projectName,
        dimensionsJson: { endpoint: "code_interpreter", sessions: result.num_sessions },
        externalId: `openai:code_interpreter:${day}:${projectId}:sessions`,
      });
      count += 1;
    }
  }
  return count;
}

/* ---------- Orchestrator ---------- */

export interface OpenAISyncResult {
  rowsUpserted: number;
  lookbackDays: number;
  errors: string[];
}

export async function syncOpenAIData(): Promise<OpenAISyncResult> {
  const db = getDb();
  const errors: string[] = [];
  let rows = 0;

  const [run] = await db
    .insert(connectorRuns)
    .values({
      sourceSystem: "openai",
      connectorName: "openai-enterprise",
      status: "running",
    })
    .returning({ id: connectorRuns.id });

  const runId = run?.id;

  try {
    const projectNames = await syncProjects();

    const membersMap = await syncUsers(Array.from(projectNames.keys()));
    rows += membersMap.size;

    const fullLookbackMs = getOpenAISyncLookbackStartMs();
    const { startMs, isIncremental } = await getIncrementalStart("openai", fullLookbackMs);
    const lookbackStartSec = Math.floor(startMs / 1000);
    const lookbackDays = Math.round((Date.now() - startMs) / (24 * 60 * 60 * 1000));

    rows += await syncCosts(projectNames, lookbackStartSec);
    rows += await syncCompletionsUsage(projectNames, membersMap, lookbackStartSec);
    rows += await syncEmbeddingsUsage(projectNames, membersMap, lookbackStartSec);
    rows += await syncImagesUsage(projectNames, membersMap, lookbackStartSec);
    rows += await syncAudioSpeechesUsage(projectNames, membersMap, lookbackStartSec);
    rows += await syncAudioTranscriptionsUsage(projectNames, membersMap, lookbackStartSec);
    rows += await syncModerationsUsage(projectNames, membersMap, lookbackStartSec);
    rows += await syncVectorStoresUsage(projectNames, lookbackStartSec);
    rows += await syncCodeInterpreterUsage(projectNames, lookbackStartSec);

    if (runId) {
      await db
        .update(connectorRuns)
        .set({
          status: "success",
          finishedAt: new Date(),
          rowsUpserted: rows,
          watermarkAt: new Date(),
          metadataJson: { lookbackDays, isIncremental },
        })
        .where(eq(connectorRuns.id, runId));
    }

    return { rowsUpserted: rows, lookbackDays, errors };
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
    return { rowsUpserted: rows, lookbackDays: 0, errors };
  }
}
