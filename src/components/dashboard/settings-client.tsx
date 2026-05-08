"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";

/* ───── Shared interfaces ─────────────────────────────── */

interface ContractBudget {
  amount: number;
  currency: string;
  startDate: string;
  endDate: string;
  label: string;
}

interface BudgetMetrics {
  spent: number;
  remaining: number;
  percentUsed: number;
  dailyBurnRate: number;
  daysUntilDepleted: number | null;
  projectedDepletionDate: string | null;
  daysElapsed: number;
  totalDaysInContract: number;
  daysRemainingInContract: number;
}

type ClaudePlanType = "seat_based" | "usage_based";

interface SeatConfig {
  costPerSeatPerMonth?: number;
  seatCount?: number;
  annualCost?: number;
  billingResetDay?: number;
  freeCreditsPerSeatPerMonth?: number;
  costPerOverageCreditUsd?: number;
  planType?: ClaudePlanType;
}

/* ───── Hooks ─────────────────────────────────────────── */

export function useBudget(source: string) {
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<BudgetMetrics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const qs = source !== "cursor" ? `?source=${source}` : "";
        const [settingsRes, metricsRes] = await Promise.all([
          fetch(`/api/settings/budget${qs}`, { cache: "no-store" }),
          fetch(`/api/metrics/budget${qs}`, { cache: "no-store" }),
        ]);
        const sJson = await settingsRes.json();
        const mJson = await metricsRes.json();
        if (sJson.budget) {
          const b = sJson.budget as ContractBudget;
          setAmount(String(b.amount));
          setStart(b.startDate);
          setEnd(b.endDate);
          setLabel(b.label || "");
        }
        if (mJson.configured && mJson.metrics) {
          setMetrics(mJson.metrics as BudgetMetrics);
        }
      } catch {
        /* not configured yet */
      } finally {
        setLoaded(true);
      }
    })();
  }, [source]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const qs = source !== "cursor" ? `?source=${source}` : "";
      const res = await fetch(`/api/settings/budget${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(amount), currency: "USD", startDate: start, endDate: end, label }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setMsg("Saved");
      const mRes = await fetch(`/api/metrics/budget${qs}`, { cache: "no-store" });
      const mJson = await mRes.json();
      if (mJson.configured && mJson.metrics) setMetrics(mJson.metrics as BudgetMetrics);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return { amount, setAmount, start, setStart, end, setEnd, label, setLabel, saving, msg, metrics, loaded, save };
}

export function useSeatConfig(source: string) {
  const [costPerSeat, setCostPerSeat] = useState("");
  const [seatCount, setSeatCount] = useState("");
  const [annualCost, setAnnualCost] = useState("");
  const [billingResetDay, setBillingResetDay] = useState("1");
  const [freeCreditsPerSeat, setFreeCreditsPerSeat] = useState("");
  const [costPerOverageCredit, setCostPerOverageCredit] = useState("");
  const [planType, setPlanType] = useState<ClaudePlanType>("seat_based");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/settings/seats?source=${source}`, { cache: "no-store" });
        const json = await res.json();
        if (json.config) {
          const c = json.config as SeatConfig;
          if (c.costPerSeatPerMonth != null) setCostPerSeat(String(c.costPerSeatPerMonth));
          if (c.seatCount != null) setSeatCount(String(c.seatCount));
          if (c.annualCost != null) setAnnualCost(String(c.annualCost));
          if (c.billingResetDay != null) setBillingResetDay(String(c.billingResetDay));
          if (c.freeCreditsPerSeatPerMonth != null) setFreeCreditsPerSeat(String(c.freeCreditsPerSeatPerMonth));
          if (c.costPerOverageCreditUsd != null) setCostPerOverageCredit(String(c.costPerOverageCreditUsd));
          if (c.planType === "seat_based" || c.planType === "usage_based") setPlanType(c.planType);
        }
      } catch {
        /* not configured */
      } finally {
        setLoaded(true);
      }
    })();
  }, [source]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body: SeatConfig = {};
      if (costPerSeat) body.costPerSeatPerMonth = parseFloat(costPerSeat);
      if (seatCount) body.seatCount = parseInt(seatCount, 10);
      if (annualCost) body.annualCost = parseFloat(annualCost);
      if (billingResetDay) body.billingResetDay = parseInt(billingResetDay, 10);
      if (freeCreditsPerSeat) body.freeCreditsPerSeatPerMonth = parseFloat(freeCreditsPerSeat);
      if (costPerOverageCredit) body.costPerOverageCreditUsd = parseFloat(costPerOverageCredit);
      body.planType = planType;

      const res = await fetch(`/api/settings/seats?source=${source}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return {
    costPerSeat,
    setCostPerSeat,
    seatCount,
    setSeatCount,
    annualCost,
    setAnnualCost,
    billingResetDay,
    setBillingResetDay,
    freeCreditsPerSeat,
    setFreeCreditsPerSeat,
    costPerOverageCredit,
    setCostPerOverageCredit,
    planType,
    setPlanType,
    saving,
    msg,
    loaded,
    save,
  };
}

export function useSync(endpoint: string) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      const parts: string[] = ["Sync ok"];
      if (json.rowsUpserted != null) parts.push(`${json.rowsUpserted} rows upserted`);
      if (json.resources) {
        const labels = (json.resources as { label: string; rows: number }[])
          .map((r) => `${r.label}: ${r.rows}`)
          .join(", ");
        parts.push(labels);
      }
      setMessage(parts.join(" · "));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return { loading, message, run };
}

/* ───── Reusable UI components ────────────────────────── */

export function SyncCard({
  title,
  description,
  envVar,
  apiRoute,
  sync,
}: {
  title: string;
  description?: string;
  envVar: string;
  apiRoute: string;
  sync: ReturnType<typeof useSync>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description ? <>{description} </> : null}
          Uses <code className="rounded bg-muted px-1 py-0.5">{envVar}</code>. For
          production, schedule <code className="rounded bg-muted px-1 py-0.5">POST {apiRoute}</code> with{" "}
          <code className="rounded bg-muted px-1 py-0.5">CRON_SECRET</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" onClick={sync.run} disabled={sync.loading}>
          {sync.loading ? "Syncing..." : "Run sync now"}
        </Button>
        {sync.message ? <div className="text-sm text-muted-foreground">{sync.message}</div> : null}
      </CardContent>
    </Card>
  );
}

export function BudgetCard({ title, description, budget: b }: { title: string; description: string; budget: ReturnType<typeof useBudget> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Budget (USD)</Label>
            <Input type="number" step="0.01" value={b.amount} onChange={(e) => b.setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Contract start</Label>
            <Input type="date" value={b.start} onChange={(e) => b.setStart(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Contract end</Label>
            <Input type="date" value={b.end} onChange={(e) => b.setEnd(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input type="text" value={b.label} onChange={(e) => b.setLabel(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={b.save} disabled={b.saving}>
            {b.saving ? "Saving..." : "Save budget"}
          </Button>
          {b.msg ? <span className="text-sm text-muted-foreground">{b.msg}</span> : null}
        </div>

        {b.loaded && b.metrics ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-muted-foreground">Budget used</span>
              <span className="text-lg font-semibold">{b.metrics.percentUsed.toFixed(1)}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, b.metrics.percentUsed)}%`,
                  backgroundColor: b.metrics.percentUsed >= 90 ? "var(--color-chart-5)" : b.metrics.percentUsed >= 70 ? "var(--color-chart-4)" : "var(--color-chart-1)",
                }}
              />
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Spent</div>
                <div className="font-semibold">{formatUsd(b.metrics.spent)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Remaining</div>
                <div className="font-semibold">{formatUsd(b.metrics.remaining)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Daily burn rate</div>
                <div className="font-semibold">{formatUsd(b.metrics.dailyBurnRate)}/day</div>
              </div>
              <div>
                <div className="text-muted-foreground">Projected depletion</div>
                <div className="font-semibold">
                  {b.metrics.projectedDepletionDate ?? "N/A"}
                  {b.metrics.daysUntilDepleted != null ? ` (${b.metrics.daysUntilDepleted}d)` : ""}
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {b.metrics.daysElapsed} days elapsed of {b.metrics.totalDaysInContract} total
              {" / "}
              {b.metrics.daysRemainingInContract} days remaining in contract
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CsvUploadZone({
  label,
  endpoint,
  fieldName,
  multiple,
  metadataEndpoint,
}: {
  label: string;
  endpoint: string;
  fieldName: string;
  multiple?: boolean;
  metadataEndpoint?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshLastUpload = useCallback(async () => {
    if (!metadataEndpoint) return;

    try {
      const res = await fetch(metadataEndpoint, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { importedAt?: string | null };
      setLastUpload(json.importedAt ?? null);
    } catch {
      // best-effort metadata display should not block uploads
    }
  }, [metadataEndpoint]);

  useEffect(() => {
    void refreshLastUpload();
  }, [refreshLastUpload]);

  const upload = useCallback(async () => {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append(fieldName, files[i]);
      }
      const res = await fetch(endpoint, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      const parts: string[] = ["Done"];
      if (json.rowsUpserted != null) parts.push(`${json.rowsUpserted} rows upserted`);
      if (json.membersUpserted != null) parts.push(`${json.membersUpserted} members`);
      if (json.totalRows != null) parts.push(`${json.totalRows} records`);
      if (json.dedupedRows != null) parts.push(`${json.dedupedRows} duplicates removed`);
      if (json.filesProcessed != null) parts.push(`${json.filesProcessed} files`);
      setResult(parts.join(" · "));
      if (json.importedAt) {
        setLastUpload(json.importedAt as string);
      } else {
        await refreshLastUpload();
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }, [endpoint, fieldName, refreshLastUpload]);

  const lastUploadLabel = lastUpload ? new Date(lastUpload).toLocaleString() : "Never";

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          ref={fileRef}
          type="file"
          accept=".csv"
          multiple={multiple}
          className="max-w-sm"
        />
        <Button type="button" size="sm" onClick={upload} disabled={uploading}>
          {uploading ? "Uploading..." : "Import"}
        </Button>
      </div>
      {metadataEndpoint ? <p className="text-xs text-muted-foreground">Last upload: {lastUploadLabel}</p> : null}
      {result ? <p className="text-sm text-muted-foreground">{result}</p> : null}
    </div>
  );
}

export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
