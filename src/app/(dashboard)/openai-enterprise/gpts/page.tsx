import { Suspense } from "react";
import { OpenAIEnterpriseGptsClient } from "@/components/dashboard/openai-enterprise-gpts-client";

export default function OpenAIEnterpriseGptsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIEnterpriseGptsClient />
    </Suspense>
  );
}
