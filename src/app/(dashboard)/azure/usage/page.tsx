import { Suspense } from "react";
import { AzureUsageClient } from "@/components/dashboard/azure-usage-client";

export default function AzureUsagePage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <AzureUsageClient />
    </Suspense>
  );
}
