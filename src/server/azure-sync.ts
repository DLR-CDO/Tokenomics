import { execSync } from "child_process";
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { connectorRuns, dimModel, usageFacts } from "@/db/schema";
import {
  getAzureResources,
  getAzureSyncLookbackDays,
  buildResourceId,
  type AzureResourceConfig,
} from "./azure-sync-config";
import { getIncrementalStart } from "./sync-utils";

type MetricKind = "tokens_in" | "tokens_out" | "requests" | "cost_usd";

const MANAGEMENT_URL = "https://management.azure.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

function getAccessToken(): string {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  try {
    const raw = execSync(
      'az account get-access-token --resource https://management.azure.com --query "{accessToken:accessToken,expiresOn:expiresOn}" -o json',
      { encoding: "utf-8", timeout: 15_000 },
    ).trim();

    const parsed = JSON.parse(raw) as { accessToken: string; expiresOn: string };
    cachedToken = {
      value: parsed.accessToken,
      expiresAt: new Date(parsed.expiresOn).getTime() - 60_000,
    };
    return cachedToken.value;
  } catch {
    throw new Error(
      "Failed to get Azure access token. Run: az login --tenant <your-tenant-id>",
    );
  }
}

async function azureFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Azure API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

interface MetricsTimeseries {
  metadatavalues: { name: { value: string }; value: string }[];
  data: { timeStamp: string; total?: number }[];
}

interface MetricsResponse {
  value: {
    name: { value: string };
    timeseries: MetricsTimeseries[];
  }[];
}

async function fetchDailyMetrics(
  token: string,
  resourceId: string,
  metricNames: string[],
  startTime: string,
  endTime: string,
): Promise<MetricsResponse> {
  const params = new URLSearchParams({
    "api-version": "2023-10-01",
    metricnames: metricNames.join(","),
    timespan: `${startTime}/${endTime}`,
    interval: "PT24H",
  });

  return azureFetch<MetricsResponse>(
    `${MANAGEMENT_URL}${resourceId}/providers/Microsoft.Insights/metrics?${params}`,
    token,
  );
}

async function fetchDailyMetricsByDeployment(
  token: string,
  resourceId: string,
  metricNames: string[],
  startTime: string,
  endTime: string,
): Promise<MetricsResponse> {
  const params = new URLSearchParams({
    "api-version": "2023-10-01",
    metricnames: metricNames.join(","),
    timespan: `${startTime}/${endTime}`,
    interval: "PT24H",
    $filter: "ModelDeploymentName eq '*'",
  });

  return azureFetch<MetricsResponse>(
    `${MANAGEMENT_URL}${resourceId}/providers/Microsoft.Insights/metrics?${params}`,
    token,
  );
}

interface CostRow {
  date: string;
  cost: number;
  resourceId: string;
}

async function fetchCostData(
  token: string,
  subscriptionId: string,
  startDate: string,
  endDate: string,
): Promise<CostRow[]> {
  const url = `${MANAGEMENT_URL}/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const body = {
    type: "ActualCost",
    dataset: {
      granularity: "Daily",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      filter: {
        dimensions: {
          name: "ResourceType",
          operator: "In",
          values: ["Microsoft.CognitiveServices/accounts"],
        },
      },
      grouping: [{ type: "Dimension", name: "ResourceId" }],
    },
    timeframe: "Custom",
    timePeriod: { from: startDate, to: endDate },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      return [];
    }
    if (!res.ok) {
      return [];
    }

    const json = (await res.json()) as {
      properties: {
        columns: { name: string }[];
        rows: (string | number)[][];
      };
    };

    const cols = json.properties.columns.map((c) => c.name);
    const costIdx = cols.indexOf("Cost");
    const dateIdx = cols.indexOf("UsageDate");
    const ridIdx = cols.indexOf("ResourceId");

    if (costIdx < 0 || dateIdx < 0 || ridIdx < 0) return [];

    return json.properties.rows.map((r) => ({
      cost: Number(r[costIdx]),
      date: String(r[dateIdx]),
      resourceId: String(r[ridIdx]).toLowerCase(),
    }));
  } catch {
    return [];
  }
}

async function upsertFact(input: {
  occurredAt: Date;
  metricKind: MetricKind;
  amount: number;
  modelName: string | null;
  billingGroupName: string | null;
  dimensionsJson?: Record<string, unknown>;
  externalId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(usageFacts)
    .values({
      occurredAt: input.occurredAt,
      sourceSystem: "azure",
      metricKind: input.metricKind,
      amount: input.amount,
      memberId: null,
      modelId: null,
      modelName: input.modelName,
      mode: null,
      billingGroupId: null,
      billingGroupName: input.billingGroupName,
      dimensionsJson: input.dimensionsJson ?? null,
      externalId: input.externalId,
    })
    .onConflictDoUpdate({
      target: [usageFacts.sourceSystem, usageFacts.externalId],
      set: {
        amount: sql`excluded.amount`,
        occurredAt: sql`excluded.occurred_at`,
        modelName: sql`excluded.model_name`,
        billingGroupName: sql`excluded.billing_group_name`,
        dimensionsJson: sql`excluded.dimensions_json`,
        ingestedAt: sql`now()`,
      },
    });
}

async function upsertModel(deploymentName: string): Promise<void> {
  const db = getDb();
  await db
    .insert(dimModel)
    .values({
      sourceSystem: "azure",
      externalKey: deploymentName,
      displayName: deploymentName,
    })
    .onConflictDoUpdate({
      target: [dimModel.sourceSystem, dimModel.externalKey],
      set: { displayName: deploymentName },
    });
}

function toIsoDate(ts: string): string {
  return ts.slice(0, 10);
}

const METRIC_MAP: Record<string, MetricKind> = {
  InputTokens: "tokens_in",
  OutputTokens: "tokens_out",
  AzureOpenAIRequests: "requests",
};

async function syncResourceMetrics(
  token: string,
  resource: AzureResourceConfig,
  startTime: string,
  endTime: string,
): Promise<number> {
  const resourceId = buildResourceId(resource);
  let rowsUpserted = 0;

  const metricsResponse = await fetchDailyMetricsByDeployment(
    token,
    resourceId,
    ["InputTokens", "OutputTokens", "AzureOpenAIRequests"],
    startTime,
    endTime,
  );

  const deployments = new Set<string>();

  for (const metric of metricsResponse.value) {
    const metricKind = METRIC_MAP[metric.name.value];
    if (!metricKind) continue;

    for (const series of metric.timeseries) {
      const deploymentName =
        series.metadatavalues.find(
          (m) => m.name.value === "modeldeploymentname",
        )?.value ?? "unknown";

      deployments.add(deploymentName);

      for (const point of series.data) {
        const total = point.total ?? 0;
        if (total === 0) continue;

        const date = toIsoDate(point.timeStamp);
        const externalId = `azure:${resource.accountName}:${deploymentName}:${date}:${metricKind}`;

        await upsertFact({
          occurredAt: new Date(`${date}T00:00:00.000Z`),
          metricKind,
          amount: total,
          modelName: deploymentName,
          billingGroupName: resource.label,
          dimensionsJson: {
            subscriptionId: resource.subscriptionId,
            resourceGroup: resource.resourceGroup,
            accountName: resource.accountName,
          },
          externalId,
        });
        rowsUpserted++;
      }
    }
  }

  for (const dep of deployments) {
    await upsertModel(dep);
  }

  return rowsUpserted;
}

async function syncCosts(
  token: string,
  resources: AzureResourceConfig[],
  startDate: string,
  endDate: string,
): Promise<number> {
  const subIds = [...new Set(resources.map((r) => r.subscriptionId))];
  let rowsUpserted = 0;

  const resourceIdToLabel = new Map<string, string>();
  for (const r of resources) {
    resourceIdToLabel.set(buildResourceId(r).toLowerCase(), r.label);
  }

  for (const subId of subIds) {
    const rows = await fetchCostData(token, subId, startDate, endDate);
    if (rows.length === 0) continue;

    for (const row of rows) {
      if (row.cost <= 0) continue;

      const label =
        resourceIdToLabel.get(row.resourceId) ??
        row.resourceId.split("/").pop() ??
        "unknown";

      const dateStr = String(row.date);
      const isoDate =
        dateStr.length === 8
          ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
          : dateStr;

      const externalId = `azure:cost:${label}:${isoDate}`;

      await upsertFact({
        occurredAt: new Date(`${isoDate}T00:00:00.000Z`),
        metricKind: "cost_usd",
        amount: row.cost,
        modelName: null,
        billingGroupName: label,
        externalId,
      });
      rowsUpserted++;
    }
  }

  return rowsUpserted;
}

export interface AzureSyncResult {
  rowsUpserted: number;
  errors: string[];
  resources: { label: string; rows: number }[];
}

export async function syncAzureData(): Promise<AzureSyncResult> {
  const resources = getAzureResources();
  if (resources.length === 0) {
    return { rowsUpserted: 0, errors: ["No AZURE_RESOURCES configured"], resources: [] };
  }

  const db = getDb();
  const [run] = await db
    .insert(connectorRuns)
    .values({
      sourceSystem: "azure",
      connectorName: "azure-monitor",
      status: "running",
    })
    .returning({ id: connectorRuns.id });

  const fullLookbackDays = getAzureSyncLookbackDays();
  const fullLookbackMs = Date.now() - fullLookbackDays * 86_400_000;
  const { startMs, isIncremental } = await getIncrementalStart("azure", fullLookbackMs);

  const endDate = new Date();
  const startDate = new Date(startMs);
  const startTime = startDate.toISOString().slice(0, 10) + "T00:00:00Z";
  const endTime = endDate.toISOString().slice(0, 10) + "T23:59:59Z";
  const lookbackDays = Math.round((Date.now() - startMs) / 86_400_000);

  const errors: string[] = [];
  const resourceResults: { label: string; rows: number }[] = [];
  let totalRows = 0;

  try {
    const token = getAccessToken();

    for (const resource of resources) {
      try {
        const rows = await syncResourceMetrics(token, resource, startTime, endTime);
        resourceResults.push({ label: resource.label, rows });
        totalRows += rows;
      } catch (e) {
        const msg = `[${resource.label}] ${e instanceof Error ? e.message : String(e)}`;
        errors.push(msg);
      }
    }

    try {
      const costRows = await syncCosts(
        token,
        resources,
        startDate.toISOString().slice(0, 10),
        endDate.toISOString().slice(0, 10),
      );
      totalRows += costRows;
      if (costRows > 0) {
        resourceResults.push({ label: "cost-management", rows: costRows });
      }
    } catch (e) {
      errors.push(`[cost] ${e instanceof Error ? e.message : String(e)}`);
    }

    await db
      .update(connectorRuns)
      .set({
        status: errors.length > 0 ? "failed" : "success",
        finishedAt: new Date(),
        rowsUpserted: totalRows,
        watermarkAt: new Date(),
        metadataJson: { resources: resourceResults, errors, lookbackDays, isIncremental } as Record<string, unknown>,
      })
      .where(eq(connectorRuns.id, run.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);

    await db
      .update(connectorRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: msg,
      })
      .where(eq(connectorRuns.id, run.id));
  }

  return { rowsUpserted: totalRows, errors, resources: resourceResults };
}
