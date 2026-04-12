import { Suspense } from "react";
import { AzureActivityClient } from "@/components/dashboard/azure-activity-client";

export default function AzureActivityPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <AzureActivityClient />
    </Suspense>
  );
}
