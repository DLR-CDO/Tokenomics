"use client";

import {
  useBudget,
  useSync,
  BudgetCard,
  SyncCard,
} from "@/components/dashboard/settings-client";

export default function OpenAIApiSettingsPage() {
  const budget = useBudget("openai");
  const sync = useSync("/api/sync/openai");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">OpenAI API</h2>
        <p className="text-sm text-muted-foreground">Data sync and contract budget for the OpenAI API Platform.</p>
      </div>

      <SyncCard
        title="Data Sync"
        envVar="OPENAI_ADMIN_API_KEY"
        apiRoute="/api/sync/openai"
        sync={sync}
      />

      <BudgetCard
        title="Contract Budget"
        description="Track spend against your OpenAI API contract allocation."
        budget={budget}
      />
    </div>
  );
}
