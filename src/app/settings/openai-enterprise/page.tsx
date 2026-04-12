"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";
import {
  useSeatConfig,
  CsvUploadZone,
} from "@/components/dashboard/settings-client";

export default function OpenAIEnterpriseSettingsPage() {
  const seats = useSeatConfig("openai_enterprise");

  const entSeats = parseInt(seats.seatCount, 10) || 0;
  const entAnnual = parseFloat(seats.annualCost) || 0;
  const entCostPerSeat = entSeats > 0 && entAnnual > 0 ? entAnnual / entSeats / 12 : null;
  const entMonthlyAllocation = entAnnual > 0 ? entAnnual / 12 : null;

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
          </div>
          {entMonthlyAllocation != null ? (
            <div className="rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Monthly allocation: </span>
              <span className="font-semibold">{formatUsd(entMonthlyAllocation)}</span>
              <span className="text-muted-foreground"> / month</span>
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
            multiple
          />
          <CsvUploadZone
            label="Users Export"
            endpoint="/api/import/openai-enterprise/users"
            fieldName="file"
          />
          <CsvUploadZone
            label="GPTs Export"
            endpoint="/api/import/openai-enterprise/gpts"
            fieldName="file"
          />
          <CsvUploadZone
            label="Projects Export"
            endpoint="/api/import/openai-enterprise/projects"
            fieldName="file"
          />
        </CardContent>
      </Card>
    </div>
  );
}
