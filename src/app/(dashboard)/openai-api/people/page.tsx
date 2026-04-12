import { Suspense } from "react";
import { OpenAIPeopleClient } from "@/components/dashboard/openai-people-client";

export default function OpenAIPeoplePage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIPeopleClient />
    </Suspense>
  );
}
