import { Suspense } from "react";
import { OpenAICostClient } from "@/components/dashboard/openai-cost-client";

export default function OpenAICostPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAICostClient />
    </Suspense>
  );
}
