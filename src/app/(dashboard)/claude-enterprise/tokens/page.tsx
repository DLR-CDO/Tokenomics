import { Suspense } from "react";

import { ClaudeEnterpriseTokensClient } from "@/components/dashboard/claude-enterprise-tokens-client";

export default function ClaudeEnterpriseTokensPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseTokensClient />
    </Suspense>
  );
}
