import { Suspense } from "react";
import { ClaudeEnterpriseBillingGroupClient } from "@/components/dashboard/claude-enterprise-billing-group-client";

export default function ClaudeEnterpriseProjectsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseBillingGroupClient
        title="Chat Projects"
        description="User-created projects in Claude.ai Chat. Counts reflect messages sent in project conversations."
        columnHeader="Project"
        metricHeader="Messages"
        mode="chat_project"
      />
    </Suspense>
  );
}
