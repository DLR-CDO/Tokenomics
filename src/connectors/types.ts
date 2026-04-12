export type SourceSystem = "cursor" | "openai" | "azure";

export interface ConnectorContext {
  databaseUrl: string;
}

export interface ConnectorSyncOptions {
  since?: Date;
  until?: Date;
}

export interface ConnectorSyncResult {
  rowsUpserted: number;
  errors: string[];
}

export interface UsageConnector {
  readonly source: SourceSystem;
  readonly name: string;
  healthCheck(): Promise<{ ok: true } | { ok: false; error: string }>;
  sync(options: ConnectorSyncOptions): Promise<ConnectorSyncResult>;
}
