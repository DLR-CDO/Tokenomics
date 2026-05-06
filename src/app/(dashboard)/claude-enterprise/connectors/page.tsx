import { Suspense } from "react";
import { ClaudeEnterpriseBillingGroupClient } from "@/components/dashboard/claude-enterprise-billing-group-client";

export default function ClaudeEnterpriseConnectorsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseBillingGroupClient
        title="Connectors"
        description="Sessions that invoked each MCP connector, summed across Chat, Claude Code, Excel, PowerPoint, and Cowork."
        columnHeader="Connector"
        metricHeader="Sessions"
        mode="connector"
      />
    </Suspense>
  );
}
