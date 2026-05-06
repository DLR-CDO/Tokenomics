"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Cross-component event fired on window after a successful save. Subscribers
 * (e.g. ForecastClient) listen for this so they refetch the forecast with the
 * new safety margin without having to poll or share state.
 */
export const SAFETY_MARGIN_CHANGED_EVENT = "forecast-settings-changed" as const;

type ForecastSettings = { safetyMarginPct: number };

const DEFAULT_PCT = 15;

/**
 * Compact inline editor for the global forecast safety margin. Drops cleanly
 * into the GlobalFilters row. Loads `/api/settings/forecast` on mount, commits
 * on blur / Enter, and emits {@link SAFETY_MARGIN_CHANGED_EVENT} on success so
 * other components refetch.
 */
export function SafetyMarginEditor({ className }: { className?: string }) {
  const [pct, setPct] = useState<number>(DEFAULT_PCT);
  const [draft, setDraft] = useState<string>(String(DEFAULT_PCT));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const lastValueRef = useRef<number>(DEFAULT_PCT);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/forecast", { cache: "no-store" });
        const json = (await res.json()) as ForecastSettings;
        if (!cancelled && Number.isFinite(json?.safetyMarginPct)) {
          const v = json.safetyMarginPct;
          setPct(v);
          setDraft(String(v));
          lastValueRef.current = v;
        }
      } catch {
        /* default 15% */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pct !== lastValueRef.current) {
      setDraft(String(pct));
      lastValueRef.current = pct;
    }
  }, [pct]);

  async function commit() {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 200) {
      setDraft(String(pct));
      return;
    }
    if (Math.abs(parsed - pct) < 0.001) return;

    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ safetyMarginPct: parsed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      const next = (json as ForecastSettings).safetyMarginPct ?? parsed;
      setPct(next);
      setDraft(String(next));
      lastValueRef.current = next;
      setStatus("Saved");
      window.dispatchEvent(
        new CustomEvent<ForecastSettings>(SAFETY_MARGIN_CHANGED_EVENT, {
          detail: { safetyMarginPct: next },
        }),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setTimeout(() => setStatus((s) => (s === "Saved" ? null : s)), 1500);
    }
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Safety margin
      </span>
      <div className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-background pl-2 pr-1">
        <input
          aria-label="Forecast safety margin (percent)"
          type="number"
          min={0}
          max={200}
          step={1}
          inputMode="decimal"
          value={draft}
          disabled={saving || !loaded}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(String(pct));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-6 w-12 bg-transparent text-right text-xs font-semibold tabular-nums focus:outline-none disabled:opacity-60"
        />
        <span className="pr-1 text-xs font-medium text-muted-foreground">%</span>
      </div>
      {status ? (
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wider",
            status === "Saved" ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {status}
        </span>
      ) : null}
    </div>
  );
}
