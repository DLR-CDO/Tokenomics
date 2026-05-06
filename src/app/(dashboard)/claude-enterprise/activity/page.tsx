import { Suspense } from "react";
import { ClaudeEnterpriseActivityClient } from "@/components/dashboard/claude-enterprise-activity-client";

export default function ClaudeEnterpriseActivityPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseActivityClient />
    </Suspense>
  );
}
