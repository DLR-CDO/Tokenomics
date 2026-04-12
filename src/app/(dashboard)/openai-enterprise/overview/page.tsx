import { Suspense } from "react";
import { OpenAIEnterpriseOverviewClient } from "@/components/dashboard/openai-enterprise-overview-client";

export default function OpenAIEnterpriseOverviewPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIEnterpriseOverviewClient />
    </Suspense>
  );
}
