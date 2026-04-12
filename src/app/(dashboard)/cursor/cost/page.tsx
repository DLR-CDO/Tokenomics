import { Suspense } from "react";

import { CostClient } from "@/components/dashboard/cost-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function CostPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-2xl" />}>
      <CostClient />
    </Suspense>
  );
}
