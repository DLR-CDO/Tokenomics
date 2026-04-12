import { Suspense } from "react";
import { AzureOverviewClient } from "@/components/dashboard/azure-overview-client";

export default function AzureOverviewPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <AzureOverviewClient />
    </Suspense>
  );
}
