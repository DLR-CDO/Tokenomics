"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";
import {
  computeEnterpriseCreditRates,
  formatCreditValuation,
  hasAnyCreditRate,
  valuateCredits,
} from "@/lib/enterprise-credits";
import {
  useSeatConfig,
  CsvUploadZone,
} from "@/components/dashboard/settings-client";

export default function OpenAIEnterpriseSettingsPage() {
  const seats = useSeatConfig("openai_enterprise");

  const entSeats = parseInt(seats.seatCount, 10) || 0;
  const entAnnual = parseFloat(seats.annualCost) || 0;
  const entFreeCreditsPerSeat = parseFloat(seats.freeCreditsPerSeat) || 0;
  const entOverageRate = parseFloat(seats.costPerOverageCredit) || 0;
  const entCostPerSeat = entSeats > 0 && entAnnual > 0 ? entAnnual / entSeats / 12 : null;
  const entMonthlyAllocation = entAnnual > 0 ? entAnnual / 12 : null;
  const entMonthlyCreditPool = entSeats > 0 && entFreeCreditsPerSeat > 0 ? entFreeCreditsPerSeat * entSeats : null;
  const entOverageExample = entOverageRate > 0 ? 1000 * entOverageRate : null;

  const creditRates = computeEnterpriseCreditRates({
    monthlyDollarAllocation: entMonthlyAllocation,
    monthlyCreditAllocation: entMonthlyCreditPool,
    costPerOverageCreditUsd: entOverageRate,
  });
  const poolValuation =
    entMonthlyCreditPool != null && hasAnyCreditRate(creditRates)
      ? valuateCredits(entMonthlyCreditPool, creditRates)
      : null;
  const poolValuationLine = poolValuation ? formatCreditValuation(poolValuation) : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">OpenAI Enterprise</h2>
        <p className="text-sm text-muted-foreground">Seat pricing and CSV data imports for your ChatGPT Enterprise workspace.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seat Pricing</CardTitle>
          <CardDescription>Track seat costs and monthly allocation for your ChatGPT Enterprise contract.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="ent-annual-cost">Annual contract cost (USD)</Label>
              <Input id="ent-annual-cost" type="number" step="0.01" value={seats.annualCost} onChange={(e) => seats.setAnnualCost(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ent-seat-count">Number of seats</Label>
              <Input id="ent-seat-count" type="number" value={seats.seatCount} onChange={(e) => seats.setSeatCount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ent-reset-day">Billing reset day (1-28)</Label>
              <Input id="ent-reset-day" type="number" min={1} max={28} value={seats.billingResetDay} onChange={(e) => seats.setBillingResetDay(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Cost per seat / month</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">
                {entCostPerSeat != null ? formatUsd(entCostPerSeat) : "—"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ent-free-credits">Free credits per seat / month</Label>
              <Input
                id="ent-free-credits"
                type="number"
                step="0.01"
                min={0}
                value={seats.freeCreditsPerSeat}
                onChange={(e) => seats.setFreeCreditsPerSeat(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ent-overage-rate">Cost per overage credit (USD)</Label>
              <Input
                id="ent-overage-rate"
                type="number"
                step="0.0001"
                min={0}
                value={seats.costPerOverageCredit}
                onChange={(e) => seats.setCostPerOverageCredit(e.target.value)}
              />
            </div>
          </div>
          {entMonthlyAllocation != null ? (
            <div className="rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Monthly allocation: </span>
              <span className="font-semibold">{formatUsd(entMonthlyAllocation)}</span>
              <span className="text-muted-foreground"> / month</span>
            </div>
          ) : null}
          {entMonthlyCreditPool != null ? (
            <div className="rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Monthly credit pool: </span>
              <span className="font-semibold">{entMonthlyCreditPool.toLocaleString()} credits</span>
              <span className="text-muted-foreground"> / month ({entFreeCreditsPerSeat.toLocaleString()} × {entSeats} seats)</span>
              {poolValuationLine ? (
                <div className="mt-1 text-xs text-muted-foreground">{poolValuationLine}</div>
              ) : null}
            </div>
          ) : null}
          {entOverageExample != null ? (
            <div className="rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Overage exposure example: </span>
              <span className="font-semibold">1,000 overage credits ≈ {formatUsd(entOverageExample)}</span>
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

      <Card>
        <CardHeader>
          <CardTitle>CSV Data Import</CardTitle>
          <CardDescription>
            Upload CSV exports from your ChatGPT Enterprise workspace analytics. Credit usage reports can be uploaded in bulk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CsvUploadZone
            label="Credit Usage Reports (monthly CSVs)"
            endpoint="/api/import/openai-enterprise/credits"
            fieldName="file"
            metadataEndpoint="/api/settings/enterprise-credits"
            multiple
          />
          <CsvUploadZone
            label="Users Export"
            endpoint="/api/import/openai-enterprise/users"
            fieldName="file"
            metadataEndpoint="/api/settings/enterprise-users"
          />
          <CsvUploadZone
            label="GPTs Export"
            endpoint="/api/import/openai-enterprise/gpts"
            fieldName="file"
            metadataEndpoint="/api/settings/enterprise-gpts"
          />
          <CsvUploadZone
            label="Projects Export"
            endpoint="/api/import/openai-enterprise/projects"
            fieldName="file"
            metadataEndpoint="/api/settings/enterprise-projects"
          />
        </CardContent>
      </Card>
    </div>
  );
}
