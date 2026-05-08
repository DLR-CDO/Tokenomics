"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatUsd } from "@/lib/format";

type Policy = {
  enabled: boolean;
  thresholdUsd: number;
  reloadAmountUsd: number;
  startedOn: string | null;
  notes?: string;
};

const DEFAULT_RELOAD = 300;

export function ClaudeExtraUsagePolicyCard() {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [threshold, setThreshold] = useState<string>("0");
  const [reloadAmount, setReloadAmount] = useState<string>(String(DEFAULT_RELOAD));
  const [startedOn, setStartedOn] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/claude-extra-usage-policy", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { policy?: Policy };
        if (!cancelled && json.policy) {
          setEnabled(json.policy.enabled !== false);
          setThreshold(String(json.policy.thresholdUsd ?? 0));
          setReloadAmount(String(json.policy.reloadAmountUsd ?? DEFAULT_RELOAD));
          setStartedOn(json.policy.startedOn ?? "");
          setNotes(json.policy.notes ?? "");
        }
      } catch {
        /* not configured yet */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        enabled,
        thresholdUsd: Number.parseFloat(threshold) || 0,
        reloadAmountUsd: Number.parseFloat(reloadAmount) || DEFAULT_RELOAD,
        startedOn: startedOn ? startedOn : null,
        notes: notes ? notes : undefined,
      };
      const res = await fetch("/api/settings/claude-extra-usage-policy", {
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

  const reloadAmountNum = Number.parseFloat(reloadAmount);
  const previewReload = Number.isFinite(reloadAmountNum) && reloadAmountNum > 0 ? reloadAmountNum : DEFAULT_RELOAD;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prepaid Extra Usage Policy</CardTitle>
        <CardDescription>
          Self-serve Enterprise (and Team) plans cover seat-included usage from the seat contract; anything above the
          included allowance draws from a Prepaid Extra Usage pool that auto-reloads by a fixed amount whenever the
          balance falls below your threshold. The Anthropic Analytics API reports the <em>consumption</em> against
          this pool — it does not surface the reload events themselves. The reload amount you set here is used to
          forecast how often your card will be charged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="extra-usage-enabled">Auto-reload enabled</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm">
              <input
                id="extra-usage-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="text-muted-foreground">{enabled ? "On" : "Off"}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="extra-usage-threshold">Reload trigger threshold (USD)</Label>
            <Input
              id="extra-usage-threshold"
              type="number"
              step="0.01"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="extra-usage-reload">Reload amount (USD)</Label>
            <Input
              id="extra-usage-reload"
              type="number"
              step="0.01"
              min={1}
              value={reloadAmount}
              onChange={(e) => setReloadAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="extra-usage-started">Effective since</Label>
            <Input
              id="extra-usage-started"
              type="date"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="extra-usage-notes">Notes (optional)</Label>
          <Textarea
            id="extra-usage-notes"
            rows={2}
            placeholder="e.g. P-card spending cap"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <span className="text-muted-foreground">Forecast assumes each rebill is </span>
          <span className="font-semibold">{formatUsd(previewReload)}</span>
          <span className="text-muted-foreground">. Burn-driven projections appear in the next card.</span>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={saving || !loaded}>
            {saving ? "Saving..." : "Save policy"}
          </Button>
          {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
