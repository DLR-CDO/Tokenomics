"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSeatConfig, useSync, SyncCard } from "@/components/dashboard/settings-client";
import { PricingReferenceCard } from "@/components/dashboard/pricing-reference-card";

type CycleResponse = {
  available: boolean;
  start?: string;
  end?: string;
};

export default function OpenAIApiSettingsPage() {
  const sync = useSync("/api/sync/openai");
  const enterpriseSeats = useSeatConfig("openai_enterprise");
  const [cycle, setCycle] = useState<CycleResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/billing-cycle?source=openai-api", { cache: "no-store" });
        const json = (await res.json()) as CycleResponse;
        if (!cancelled) setCycle(json);
      } catch {
        if (!cancelled) setCycle({ available: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterpriseSeats.billingResetDay]);

  const cycleLabel = cycle?.available && cycle.start && cycle.end ? `${cycle.start} to ${cycle.end}` : "Not configured";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">OpenAI API</h2>
        <p className="text-sm text-muted-foreground">
          Data sync and per-model list pricing for the OpenAI API Platform. OpenAI bills per use, so there is no
          contract budget — instead we track list rates per model and compare against the billed cost.
        </p>
      </div>

      <SyncCard
        title="Data Sync"
        envVar="OPENAI_ADMIN_API_KEY"
        apiRoute="/api/sync/openai"
        sync={sync}
      />

      <Card>
        <CardHeader>
          <CardTitle>Billing Cycle</CardTitle>
          <CardDescription>
            OpenAI API reporting inherits the OpenAI Enterprise billing reset day so API spend lines up with the
            enterprise funding period.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="openai-api-reset-day">Billing reset day</Label>
            <Input
              id="openai-api-reset-day"
              value={enterpriseSeats.billingResetDay ? `Day ${enterpriseSeats.billingResetDay}` : "Not configured"}
              readOnly
              className="bg-muted/40"
            />
            <p className="text-xs text-muted-foreground">Managed in OpenAI Enterprise settings.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="openai-api-current-cycle">Current cycle</Label>
            <Input id="openai-api-current-cycle" value={cycleLabel} readOnly className="bg-muted/40" />
            <p className="text-xs text-muted-foreground">Used by the global date filter when `Cycle` is selected.</p>
          </div>
        </CardContent>
      </Card>

      <PricingReferenceCard />
    </div>
  );
}
