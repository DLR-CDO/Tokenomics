"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSync, SyncCard } from "@/components/dashboard/settings-client";

export default function SettingsOverviewPage() {
  const cursorSync = useSync("/api/sync/cursor");
  const openaiSync = useSync("/api/sync/openai");
  const azureSync = useSync("/api/sync/azure");
  const claudeEnterpriseSync = useSync("/api/sync/claude-enterprise");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">Run data syncs and manage general dashboard configuration.</p>
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Data Sync</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          <SyncCard
            title="Cursor"
            envVar="CURSOR_ADMIN_API_KEY"
            apiRoute="/api/sync/cursor"
            sync={cursorSync}
          />
          <SyncCard
            title="OpenAI API"
            envVar="OPENAI_ADMIN_API_KEY"
            apiRoute="/api/sync/openai"
            sync={openaiSync}
          />
          <SyncCard
            title="Azure"
            description="Syncs metrics from all configured Azure AI resources."
            envVar="AZURE_RESOURCES"
            apiRoute="/api/sync/azure"
            sync={azureSync}
          />
          <SyncCard
            title="Claude Enterprise"
            description="Analytics API engagement (chat, cowork, office, skills, connectors). Data has a 3-day lag and begins 2026-01-01."
            envVar="CLAUDE_ANALYTICS_API_KEY"
            apiRoute="/api/sync/claude-enterprise"
            sync={claudeEnterpriseSync}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Developer</h3>
        <Card>
          <CardHeader>
            <CardTitle>Local development checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Copy <code className="rounded bg-muted px-1 py-0.5">.env.example</code> to <code className="rounded bg-muted px-1 py-0.5">.env</code>.</li>
              <li>Start Postgres: <code className="rounded bg-muted px-1 py-0.5">docker compose up -d</code></li>
              <li>Apply schema: <code className="rounded bg-muted px-1 py-0.5">npm run db:push</code></li>
              <li>Seed demo data: <code className="rounded bg-muted px-1 py-0.5">npm run db:seed</code> (or run a real sync)</li>
            </ol>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
