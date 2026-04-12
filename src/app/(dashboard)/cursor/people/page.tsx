import { Suspense } from "react";

import { PeopleClient } from "@/components/dashboard/people-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function PeoplePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
      <PeopleClient />
    </Suspense>
  );
}
