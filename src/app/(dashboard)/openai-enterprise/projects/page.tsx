import { Suspense } from "react";
import { OpenAIEnterpriseProjectsClient } from "@/components/dashboard/openai-enterprise-projects-client";

export default function OpenAIEnterpriseProjectsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIEnterpriseProjectsClient />
    </Suspense>
  );
}
