"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";
import { useSeatConfig, useSync, SyncCard } from "@/components/dashboard/settings-client";
import { ClaudeEnterpriseReconCard } from "@/components/dashboard/claude-enterprise-recon-card";
import { ClaudeExtraUsagePolicyCard } from "@/components/dashboard/claude-extra-usage-policy-card";
import { ClaudeBurnForecastCard } from "@/components/dashboard/claude-burn-forecast-card";

type SeatSnapshot = {
  capturedOn: string;
  assignedSeats: number;
  pendingInvites: number;
  dau: number;
  wau: number;
  mau: number;
};

export default function ClaudeEnterpriseSettingsPage() {
  const seats = useSeatConfig("claude_enterprise");
  const sync = useSync("/api/sync/claude-enterprise");

  const [snapshot, setSnapshot] = useState<SeatSnapshot | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/claude-enterprise/snapshot", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.snapshot) {
          setSnapshot(json.snapshot as SeatSnapshot);
          setCapturedAt(json.capturedAt ?? null);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const entSeats = parseInt(seats.seatCount, 10) || 0;
  const entAnnual = parseFloat(seats.annualCost) || 0;
  const entCostPerSeat = entSeats > 0 && entAnnual > 0 ? entAnnual / entSeats / 12 : null;
  const entMonthlyAllocation = entAnnual > 0 ? entAnnual / 12 : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Claude Enterprise</h2>
        <p className="text-sm text-muted-foreground">
          Self-serve Enterprise — seat-based with pre-purchased extra usage. The Anthropic Analytics API is the
          authoritative source for spend; no manual receipt entry required.
        </p>
      </div>

      <SyncCard
        title="Data Sync"
        description="Uses the Enterprise Analytics API plus the Admin Claude Code endpoint for productivity metrics."
        envVar="CLAUDE_ANALYTICS_API_KEY"
        apiRoute="/api/sync/claude-enterprise"
        sync={sync}
      />

      <ClaudeEnterpriseReconCard />

      <Card>
        <CardHeader>
          <CardTitle>Contract</CardTitle>
          <CardDescription>
            The flat seat fee covers each seat&apos;s included usage allowance. Extra usage above the allowance is
            billed separately via the Prepaid Extra Usage pool (configured below).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="claude-annual-cost">Annual seat fee (USD)</Label>
              <Input
                id="claude-annual-cost"
                type="number"
                step="0.01"
                value={seats.annualCost}
                onChange={(e) => seats.setAnnualCost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="claude-seat-count">Number of seats</Label>
              <Input
                id="claude-seat-count"
                type="number"
                value={seats.seatCount}
                onChange={(e) => seats.setSeatCount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="claude-reset-day">Billing reset day (1-28)</Label>
              <Input
                id="claude-reset-day"
                type="number"
                min={1}
                max={28}
                value={seats.billingResetDay}
                onChange={(e) => seats.setBillingResetDay(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Cost per seat / month</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">
                {entCostPerSeat != null ? formatUsd(entCostPerSeat) : "—"}
              </div>
            </div>
          </div>
          {entMonthlyAllocation != null ? (
            <div className="rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Monthly seat allocation: </span>
              <span className="font-semibold">{formatUsd(entMonthlyAllocation)}</span>
              <span className="text-muted-foreground"> / month (seat fee only — extras tracked separately)</span>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <Button type="button" onClick={seats.save} disabled={seats.saving}>
              {seats.saving ? "Saving..." : "Save"}
            </Button>
            {seats.msg ? <span className="text-sm text-muted-foreground">{seats.msg}</span> : null}
          </div>
        </CardContent>
      </Card>

      <ClaudeExtraUsagePolicyCard />

      <ClaudeBurnForecastCard />

      <Card>
        <CardHeader>
          <CardTitle>Live Seat Snapshot</CardTitle>
          <CardDescription>
            Captured from <code className="rounded bg-muted px-1 py-0.5">/analytics/summaries</code> on the most
            recent sync. Data is always ≥3 days behind real time; the Analytics API does not expose current-day
            numbers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              <div>
                <div className="text-muted-foreground">Assigned seats</div>
                <div className="text-lg font-semibold">{snapshot.assignedSeats}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Pending invites</div>
                <div className="text-lg font-semibold">{snapshot.pendingInvites}</div>
              </div>
              <div>
                <div className="text-muted-foreground">DAU / WAU / MAU</div>
                <div className="text-lg font-semibold">
                  {snapshot.dau} · {snapshot.wau} · {snapshot.mau}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Captured for</div>
                <div className="text-lg font-semibold">{snapshot.capturedOn}</div>
                {capturedAt ? (
                  <div className="text-xs text-muted-foreground">Synced {new Date(capturedAt).toLocaleString()}</div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No snapshot yet. Run a sync once{" "}
              <code className="rounded bg-muted px-1 py-0.5">CLAUDE_ANALYTICS_API_KEY</code> is configured.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Caveats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Analytics data starts <strong>2026-01-01</strong>. Earlier dates return <code>400</code> and are
              skipped.
            </li>
            <li>
              Only the last <strong>90 days</strong> are retained by Anthropic. If sync lapses for longer, the gap
              cannot be backfilled.
            </li>
            <li>Data has a 3-day lag; the most recent available date is always <code>today − 3</code>.</li>
            <li>
              Prepaid Extra Usage <em>consumption</em> appears in <code>cost_usd</code> on a 3-day lag and continues
              to revise for up to 30 days. Auto-reload events themselves are not surfaced by the API — only the
              consumption that triggers them, so rebill markers in the dashboard charts are derived from the
              cumulative-burn curve crossing the configured reload amount.
            </li>
            <li>
              Analytics keys require the <code>read:analytics</code> scope and can only be minted by a Primary Owner
              at <code>claude.ai/analytics/api-keys</code>.
            </li>
            <li>
              Claude Code usage routed via <strong>Amazon Bedrock</strong> is invisible to the Analytics API. The
              Admin API still captures it, so we source Claude Code productivity from{" "}
              <code>/v1/organizations/usage_report/claude_code</code>.
            </li>
            <li>Default rate limit is 60 rpm. The sync throttles automatically to stay under it.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
