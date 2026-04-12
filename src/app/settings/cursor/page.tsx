"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";
import {
  useBudget,
  useSeatConfig,
  useSync,
  BudgetCard,
  SyncCard,
} from "@/components/dashboard/settings-client";

export default function CursorSettingsPage() {
  const budget = useBudget("cursor");
  const seats = useSeatConfig("cursor");
  const sync = useSync("/api/sync/cursor");

  const monthlySeatCost =
    seats.costPerSeat && seats.seatCount
      ? parseFloat(seats.costPerSeat) * parseInt(seats.seatCount, 10)
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Cursor</h2>
        <p className="text-sm text-muted-foreground">Data sync, contract budget, and seat pricing for Cursor.</p>
      </div>

      <SyncCard
        title="Data Sync"
        envVar="CURSOR_ADMIN_API_KEY"
        apiRoute="/api/sync/cursor"
        sync={sync}
      />

      <BudgetCard
        title="Contract Budget"
        description="Track spend against your Cursor contract allocation."
        budget={budget}
      />

      <Card>
        <CardHeader>
          <CardTitle>Seat Pricing</CardTitle>
          <CardDescription>Track per-seat costs for your Cursor subscription.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cursor-seat-cost">Cost per seat / month (USD)</Label>
              <Input id="cursor-seat-cost" type="number" step="0.01" value={seats.costPerSeat} onChange={(e) => seats.setCostPerSeat(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cursor-seat-count">Seat count</Label>
              <Input id="cursor-seat-count" type="number" value={seats.seatCount} onChange={(e) => seats.setSeatCount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Monthly seat cost</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold">
                {monthlySeatCost != null ? formatUsd(monthlySeatCost) : "—"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={seats.save} disabled={seats.saving}>
              {seats.saving ? "Saving..." : "Save"}
            </Button>
            {seats.msg ? <span className="text-sm text-muted-foreground">{seats.msg}</span> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
