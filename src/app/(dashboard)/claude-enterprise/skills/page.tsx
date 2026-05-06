import { Suspense } from "react";
import { ClaudeEnterpriseBillingGroupClient } from "@/components/dashboard/claude-enterprise-billing-group-client";

export default function ClaudeEnterpriseSkillsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterpriseBillingGroupClient
        title="Skills"
        description="Sessions in which a Skill was used, summed across Chat, Claude Code, Excel, PowerPoint, and Cowork."
        columnHeader="Skill"
        metricHeader="Sessions"
        mode="skill"
      />
    </Suspense>
  );
}
