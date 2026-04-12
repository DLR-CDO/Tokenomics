import { Suspense } from "react";

import { OverviewClient } from "@/components/dashboard/overview-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function OverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <OverviewClient />
    </Suspense>
  );
}
