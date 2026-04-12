import { Suspense } from "react";
import { OpenAIEnterpriseActivityClient } from "@/components/dashboard/openai-enterprise-activity-client";

export default function OpenAIEnterpriseActivityPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIEnterpriseActivityClient />
    </Suspense>
  );
}
