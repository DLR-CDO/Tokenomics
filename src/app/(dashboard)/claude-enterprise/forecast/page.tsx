import { Suspense } from "react";
import { ForecastClient } from "@/components/dashboard/forecast-client";

export default function ClaudeEnterpriseForecastPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <ForecastClient source="claude_enterprise" />
    </Suspense>
  );
}
