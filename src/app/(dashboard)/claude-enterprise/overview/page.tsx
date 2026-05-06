import { Suspense } from "react";
import { ClaudeEnterpriseOverviewClient } from "@/components/dashboard/claude-enterprise-overview-client";

export default function ClaudeEnterpriseOverviewPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseOverviewClient />
    </Suspense>
  );
}
