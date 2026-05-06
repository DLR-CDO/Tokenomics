"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";

type Purchase = {
  id?: string;
  date: string;
  amountUsd: number;
  note?: string;
};

type Props = {
  source: string;
  title?: string;
  description?: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SupplementalPurchasesCard({
  source,
  title = "Supplemental Purchases",
  description = "Track mid-cycle top-ups (credit additions, plan upgrades) that aren't part of the base contract. Each entry is added to total spend on its purchase date.",
}: Props) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [draftDate, setDraftDate] = useState<string>(todayIso());
  const [draftAmount, setDraftAmount] = useState<string>("");
  const [draftNote, setDraftNote] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/settings/supplemental-purchases?source=${source}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && Array.isArray(json.purchases)) {
          setPurchases(json.purchases as Purchase[]);
        }
      } catch {
        /* not configured */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const total = useMemo(() => purchases.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0), [purchases]);

  async function persist(next: Purchase[]) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/settings/supplemental-purchases?source=${source}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchases: next.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            date: p.date,
            amountUsd: Number(p.amountUsd) || 0,
            ...(p.note ? { note: p.note } : {}),
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setPurchases((json.purchases as Purchase[]) ?? next);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function addDraft() {
    const amount = Number.parseFloat(draftAmount);
    if (!draftDate || !Number.isFinite(amount) || amount <= 0) {
      setMsg("Enter a valid date and a positive amount.");
      return;
    }
    const next: Purchase[] = [
      ...purchases,
      {
        date: draftDate,
        amountUsd: amount,
        ...(draftNote.trim() ? { note: draftNote.trim() } : {}),
      },
    ].sort((a, b) => a.date.localeCompare(b.date));
    setDraftAmount("");
    setDraftNote("");
    setDraftDate(todayIso());
    void persist(next);
  }

  function removeAt(index: number) {
    const next = purchases.filter((_, i) => i !== index);
    void persist(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor={`sp-date-${source}`}>Purchase date</Label>
            <Input
              id={`sp-date-${source}`}
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sp-amount-${source}`}>Amount (USD)</Label>
            <Input
              id={`sp-amount-${source}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="300.00"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`sp-note-${source}`}>Note (optional)</Label>
            <Input
              id={`sp-note-${source}`}
              type="text"
              placeholder="e.g. Mid-cycle top-up — usage spike on agent rollouts"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
            />
          </div>
          <Button type="button" onClick={addDraft} disabled={saving || !loaded}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>

        {purchases.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold">Note</th>
                  <th className="w-10 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p, i) => (
                  <tr key={`${p.date}-${i}`} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{p.date}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatUsd(Number(p.amountUsd) || 0)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.note ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => removeAt(i)}
                        aria-label={`Remove purchase from ${p.date}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 text-sm">
                <tr>
                  <td className="px-3 py-2 font-medium">Total</td>
                  <td className="px-3 py-2 text-right font-bold">{formatUsd(total)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {purchases.length} entr{purchases.length === 1 ? "y" : "ies"}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loaded ? "No supplemental purchases recorded yet." : "Loading…"}
          </p>
        )}

        {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}
