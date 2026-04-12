import { Suspense } from "react";
import { GlobalOverviewClient } from "@/components/dashboard/global-overview-client";

export default function GlobalOverviewPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <GlobalOverviewClient />
    </Suspense>
  );
}
