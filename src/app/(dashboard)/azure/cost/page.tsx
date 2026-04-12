import { Suspense } from "react";
import { AzureCostClient } from "@/components/dashboard/azure-cost-client";

export default function AzureCostPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <AzureCostClient />
    </Suspense>
  );
}
