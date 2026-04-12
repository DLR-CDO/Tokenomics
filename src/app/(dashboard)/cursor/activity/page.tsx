import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityClient } from "@/components/dashboard/activity-client";

export default function ActivityPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-2xl" />}>
      <ActivityClient />
    </Suspense>
  );
}
