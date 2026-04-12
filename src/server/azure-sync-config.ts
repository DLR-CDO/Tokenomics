export interface AzureResourceConfig {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
  label: string;
}

export function getAzureResources(): AzureResourceConfig[] {
  const raw = process.env.AZURE_RESOURCES;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AzureResourceConfig[];
  } catch {
    throw new Error("AZURE_RESOURCES env var is not valid JSON");
  }
}

export function getAzureSyncLookbackDays(): number {
  const days = parseInt(process.env.AZURE_SYNC_LOOKBACK_DAYS ?? "90", 10);
  return Math.min(Math.max(days, 1), 365);
}

export function buildResourceId(r: AzureResourceConfig): string {
  return `/subscriptions/${r.subscriptionId}/resourceGroups/${r.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${r.accountName}`;
}
