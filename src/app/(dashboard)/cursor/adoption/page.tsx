import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AdoptionClient } from "@/components/dashboard/adoption-client";

export default function AdoptionPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-2xl" />}>
      <AdoptionClient />
    </Suspense>
  );
}
