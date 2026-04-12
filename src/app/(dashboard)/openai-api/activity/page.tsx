import { Suspense } from "react";
import { OpenAIActivityClient } from "@/components/dashboard/openai-activity-client";

export default function OpenAIActivityPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIActivityClient />
    </Suspense>
  );
}
