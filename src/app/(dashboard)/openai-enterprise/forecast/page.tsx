import { Suspense } from "react";
import { ForecastClient } from "@/components/dashboard/forecast-client";

export default function OpenAIEnterpriseForecastPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ForecastClient source="openai_enterprise" />
    </Suspense>
  );
}
