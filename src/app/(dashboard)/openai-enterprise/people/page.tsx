import { Suspense } from "react";
import { OpenAIEnterprisePeopleClient } from "@/components/dashboard/openai-enterprise-people-client";

export default function OpenAIEnterprisePeoplePage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 rounded-2xl bg-muted/50" />}>
      <OpenAIEnterprisePeopleClient />
    </Suspense>
  );
}
