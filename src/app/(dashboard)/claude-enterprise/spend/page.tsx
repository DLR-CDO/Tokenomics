import { Suspense } from "react";

import { ClaudeEnterpriseSpendClient } from "@/components/dashboard/claude-enterprise-spend-client";

export default function ClaudeEnterpriseSpendPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseSpendClient />
    </Suspense>
  );
}
