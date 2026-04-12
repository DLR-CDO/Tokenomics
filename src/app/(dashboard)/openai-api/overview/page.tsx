import { Suspense } from "react";
import { OpenAIOverviewClient } from "@/components/dashboard/openai-overview-client";

export default function OpenAIOverviewPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIOverviewClient />
    </Suspense>
  );
}
