"use client";

import {
  useSync,
  SyncCard,
} from "@/components/dashboard/settings-client";

export default function AzureSettingsPage() {
  const sync = useSync("/api/sync/azure");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Azure</h2>
        <p className="text-sm text-muted-foreground">Data sync for Azure AI Foundry resources. Resource configuration is managed via the AZURE_RESOURCES environment variable.</p>
      </div>

      <SyncCard
        title="Data Sync"
        description="Syncs token metrics and cost data from all configured Azure AI resources."
        envVar="AZURE_RESOURCES"
        apiRoute="/api/sync/azure"
        sync={sync}
      />
    </div>
  );
}
