import { Suspense } from "react";
import { ClaudeEnterprisePeopleClient } from "@/components/dashboard/claude-enterprise-people-client";

export default function ClaudeEnterprisePeoplePage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ClaudeEnterprisePeopleClient />
    </Suspense>
  );
}
