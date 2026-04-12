import type { ConnectorSyncOptions, ConnectorSyncResult, UsageConnector } from "./types";

import { syncOpenAIData } from "@/server/openai-sync";

export const openaiConnector: UsageConnector = {
  source: "openai",
  name: "openai-enterprise",

  async healthCheck() {
    const key = process.env.OPENAI_ADMIN_API_KEY;
    if (!key) return { ok: false as const, error: "OPENAI_ADMIN_API_KEY is not configured." };
    return { ok: true as const };
  },

  async sync(_options: ConnectorSyncOptions): Promise<ConnectorSyncResult> {
    const result = await syncOpenAIData();
    return { rowsUpserted: result.rowsUpserted, errors: result.errors };
  },
};
