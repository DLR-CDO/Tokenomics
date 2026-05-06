"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatISO, format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { SliderPills } from "@/components/ui/slider-pills";
import { SafetyMarginEditor } from "@/components/dashboard/safety-margin-editor";

type DatePreset = "cycle" | "1d" | "30d" | "90d" | "manual";
type NDayPreset = "1d" | "30d" | "90d";

const PILL_PRESETS: readonly { id: DatePreset; label: string }[] = [
  { id: "cycle", label: "Cycle" },
  { id: "1d", label: "1d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
];

const PRESET_DAYS: Record<NDayPreset, number> = {
  "1d": 1,
  "30d": 30,
  "90d": 90,
};

interface CycleResponse {
  available: boolean;
  start?: string;
  end?: string;
  label?: string;
  offset?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

function parseCycleOffset(raw: string | null): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(0, n);
}

function toInputDate(d: Date): string {
  return formatISO(d, { representation: "date" });
}

function lastNDays(n: number): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getTime() - (n - 1) * 86400000);
  return { from: toInputDate(from), to: toInputDate(today) };
}

function formatRange(from: string, to: string): string {
  try {
    const f = format(parseISO(from), "MMM d");
    const t = format(parseISO(to), "MMM d, yyyy");
    return `${f} – ${t}`;
  } catch {
    return `${from} – ${to}`;
  }
}

function isDatePreset(v: string | null): v is DatePreset {
  return v === "cycle" || v === "1d" || v === "30d" || v === "90d" || v === "manual";
}

/**
 * Resolve the active platform slug from the pathname, mirroring the logic in
 * `top-nav.tsx`. Returns "" when the path is not a recognized platform page
 * (e.g. /settings/...), which causes the cycle endpoint to report unavailable.
 */
function resolvePlatform(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  const joined = segments.length >= 2 ? `${segments[0]}-${segments[1]}` : segments[0]!;
  const known = new Set(["global", "cursor", "openai-enterprise", "openai-api", "azure"]);
  if (known.has(joined)) return joined;
  if (known.has(segments[0]!)) return segments[0]!;
  return "";
}

export function GlobalFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<DatePreset>("cycle");
  const [cycleOffset, setCycleOffset] = useState(0);
  const [cycle, setCycle] = useState<CycleResponse | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last (platform, preset, from, to, cycleOffset) we wrote to the
  // URL so the sync effect doesn't re-fire after its own router.replace.
  const lastApplied = useRef<{
    platform: string;
    preset: DatePreset;
    from: string;
    to: string;
    cycleOffset: number;
  } | null>(null);
  // Per-(platform, offset) cycle response cache so re-mounts / repeated
  // visits / quick prev-next presses don't re-fetch.
  const cycleCache = useRef<Map<string, CycleResponse>>(new Map());

  const platform = resolvePlatform(pathname);

  /** Push a new filter state to the URL, preserving model/memberId. */
  const writeUrl = useCallback(
    (
      next: { from: string; to: string; preset: DatePreset; cycleOffset?: number },
      mode: "push" | "replace" = "replace",
    ) => {
      const params = new URLSearchParams();
      params.set("from", next.from);
      params.set("to", next.to);
      params.set("datePreset", next.preset);
      if (next.preset === "cycle" && next.cycleOffset !== undefined && next.cycleOffset < 0) {
        params.set("cycleOffset", String(next.cycleOffset));
      }
      const model = searchParams.get("model");
      const memberId = searchParams.get("memberId");
      if (model) params.set("model", model);
      if (memberId) params.set("memberId", memberId);
      const url = `${pathname}?${params.toString()}`;
      if (mode === "push") router.push(url);
      else router.replace(url);
    },
    [pathname, router, searchParams],
  );

  /** Debounced URL push for keystrokes inside the date inputs. */
  const debouncedPush = useCallback(
    (next: { from: string; to: string; preset: DatePreset }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => writeUrl(next, "push"), 300);
    },
    [writeUrl],
  );

  // Sync effect: reconcile URL ↔ chosen preset and ALWAYS make sure the
  // platform's cycle is fetched (or pulled from cache) so the Cycle pill
  // enables itself even when the user lands on a non-cycle preset like
  // ?datePreset=30d. The URL is the source of truth; we mirror it into
  // local state for the controlled inputs, hence the eslint-disable for
  // `set-state-in-effect`.
  /* eslint-disable react-hooks/set-state-in-effect -- mirroring URL search params into controlled state */
  useEffect(() => {
    const params = new URLSearchParams(searchKey);
    const urlPreset: DatePreset = isDatePreset(params.get("datePreset")) ? (params.get("datePreset") as DatePreset) : "cycle";
    const urlFrom = params.get("from") ?? "";
    const urlTo = params.get("to") ?? "";
    const urlCycleOffset = parseCycleOffset(params.get("cycleOffset"));

    // Already reconciled this exact (platform, preset, from, to, cycleOffset) — just hydrate state.
    const last = lastApplied.current;
    if (
      last &&
      last.platform === platform &&
      last.preset === urlPreset &&
      last.from === urlFrom &&
      last.to === urlTo &&
      last.cycleOffset === urlCycleOffset
    ) {
      setFrom(urlFrom);
      setTo(urlTo);
      setPreset(urlPreset);
      setCycleOffset(urlCycleOffset);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    // The cycle response is needed even on non-cycle presets so the Cycle
    // pill can enable itself. We always fetch (or use the cache) for the
    // offset that matters — the active offset when in cycle mode, else 0.
    const cycleFetchOffset = urlPreset === "cycle" ? urlCycleOffset : 0;

    const apply = (
      newFrom: string,
      newTo: string,
      newPreset: DatePreset,
      nextCycle: CycleResponse | null,
      nextOffset: number,
    ) => {
      if (cancelled) return;
      lastApplied.current = {
        platform,
        preset: newPreset,
        from: newFrom,
        to: newTo,
        cycleOffset: nextOffset,
      };
      setCycle(nextCycle);
      setCycleOffset(nextOffset);
      if (
        urlFrom === newFrom &&
        urlTo === newTo &&
        urlPreset === newPreset &&
        urlCycleOffset === nextOffset
      ) {
        setFrom(newFrom);
        setTo(newTo);
        setPreset(newPreset);
        return;
      }
      writeUrl({ from: newFrom, to: newTo, preset: newPreset, cycleOffset: nextOffset }, "replace");
    };

    /** Resolve and apply the preset's effective state once we know the cycle response. */
    const finishWith = (resp: CycleResponse | null) => {
      if (cancelled) return;

      if (urlPreset === "manual") {
        const f = urlFrom || lastNDays(30).from;
        const t = urlTo || lastNDays(30).to;
        apply(f, t, "manual", resp, 0);
        return;
      }

      if (urlPreset === "1d" || urlPreset === "30d" || urlPreset === "90d") {
        const seed = lastNDays(PRESET_DAYS[urlPreset]);
        apply(seed.from, seed.to, urlPreset, resp, 0);
        return;
      }

      // urlPreset === "cycle"
      if (resp?.available && resp.start && resp.end) {
        apply(resp.start, resp.end, "cycle", resp, urlCycleOffset);
      } else if (urlFrom && urlTo) {
        apply(urlFrom, urlTo, "cycle", resp, urlCycleOffset);
      } else {
        const seed = lastNDays(30);
        apply(seed.from, seed.to, "cycle", resp, urlCycleOffset);
      }
    };

    const cacheKey = `${platform}|${cycleFetchOffset}`;
    const cached = cycleCache.current.get(cacheKey);

    if (cached) {
      finishWith(cached);
    } else if (!platform) {
      finishWith(null);
    } else {
      fetch(`/api/settings/billing-cycle?source=${platform}&offset=${cycleFetchOffset}`, { signal: ac.signal })
        .then((r) => r.json() as Promise<CycleResponse>)
        .then((data) => {
          if (cancelled) return;
          cycleCache.current.set(cacheKey, data);
          finishWith(data);
        })
        .catch(() => finishWith({ available: false }));
    }

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [pathname, platform, searchKey, writeUrl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Outside-click / Escape dismiss for the date dropdown.
  useEffect(() => {
    if (!dateOpen) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDateOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDateOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [dateOpen]);

  const handlePillClick = (next: DatePreset) => {
    if (next === "cycle") {
      // Force a cycle re-fetch in case settings changed and we cached "unavailable".
      cycleCache.current.delete(`${platform}|0`);
      lastApplied.current = null;
      // Push with current dates and offset 0; the sync effect will replace
      // them with the current cycle dates if available.
      writeUrl(
        { from: from || lastNDays(30).from, to: to || lastNDays(30).to, preset: "cycle", cycleOffset: 0 },
        "push",
      );
      return;
    }
    if (next === "1d" || next === "30d" || next === "90d") {
      const seed = lastNDays(PRESET_DAYS[next]);
      writeUrl({ from: seed.from, to: seed.to, preset: next }, "push");
      return;
    }
    // "manual" is implicit — only entered via input edit.
  };

  const handleFromChange = (val: string) => {
    setFrom(val);
    setPreset("manual");
    if (val && to) debouncedPush({ from: val, to, preset: "manual" });
  };

  const handleToChange = (val: string) => {
    setTo(val);
    setPreset("manual");
    if (from && val) debouncedPush({ from, to: val, preset: "manual" });
  };

  /** Step the cycle window by `delta` (negative = older, positive = newer). */
  const stepCycle = (delta: number) => {
    const target = Math.min(0, cycleOffset + delta);
    if (target === cycleOffset) return;
    // Drop any cached entry for the new offset so the sync effect re-fetches
    // and writes the new from/to into the URL.
    cycleCache.current.delete(`${platform}|${target}`);
    lastApplied.current = null;
    // Use existing from/to as a placeholder; the sync effect will overwrite
    // them with the resolved cycle range.
    const placeholderFrom = from || lastNDays(30).from;
    const placeholderTo = to || lastNDays(30).to;
    writeUrl(
      { from: placeholderFrom, to: placeholderTo, preset: "cycle", cycleOffset: target },
      "push",
    );
  };

  const cycleRangeLabel = cycle?.available && cycle.start && cycle.end ? formatRange(cycle.start, cycle.end) : null;
  const globalCycleMode = platform === "global";
  const cycleSupported = globalCycleMode || (cycle?.available ?? false);
  const isForecastPage = pathname.endsWith("/forecast");
  /** Prev / range / (Current | Next) row only when the user is actually in cycle preset. */
  const cycleNavEnabled = preset === "cycle" && cycleSupported;
  /** Affordance to switch into cycle preset from the dropdown when not currently on it. */
  const showUseCycleButton = preset !== "cycle" && cycleSupported;
  const atCurrentCycle = cycleOffset === 0;

  /** Switch into cycle preset at the current (offset=0) cycle. */
  const handleUseCycleClick = () => {
    cycleCache.current.delete(`${platform}|0`);
    lastApplied.current = null;
    writeUrl(
      { from: from || lastNDays(30).from, to: to || lastNDays(30).to, preset: "cycle", cycleOffset: 0 },
      "push",
    );
    setDateOpen(false);
  };

  return (
    <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setDateOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          {from && to ? formatRange(from, to) : "Select dates"}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {dateOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-72 space-y-3 rounded-xl border border-border/60 bg-card p-3 shadow-lg">
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Billing cycle</div>
              {cycleNavEnabled ? (
                <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background px-1 py-1">
                  <button
                    type="button"
                    onClick={() => stepCycle(-1)}
                    aria-label="Previous cycle"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1 text-center text-xs">
                    {globalCycleMode ? (
                      <div className="flex flex-col">
                        <span className="font-medium">Per-app billing cycles</span>
                        <span className="text-[10px] text-muted-foreground">
                          {atCurrentCycle ? "Current per-app cycles" : `Each app, ${Math.abs(cycleOffset)} cycle${Math.abs(cycleOffset) === 1 ? "" : "s"} back`}
                        </span>
                      </div>
                    ) : (
                      <span className="font-medium">{cycleRangeLabel ?? "—"}</span>
                    )}
                  </div>
                  {atCurrentCycle ? (
                    <span className="inline-flex h-7 items-center rounded-md bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Current
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => stepCycle(1)}
                      aria-label="Next cycle"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : showUseCycleButton ? (
                <button
                  type="button"
                  onClick={handleUseCycleClick}
                  className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
                >
                  <span className="truncate">
                    {globalCycleMode ? "Use per-app billing cycles" : `Use current cycle: ${cycleRangeLabel ?? "—"}`}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ) : (
                <div className="rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                  No billing cycle for this tool
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => handleFromChange(e.target.value)}
                  className="rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => handleToChange(e.target.value)}
                  className="rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <SliderPills activeKey={preset} ariaLabel="Date range preset">
        {PILL_PRESETS.map((p) => {
          const active = preset === p.id;
          const disabled = p.id === "cycle" && !cycleSupported;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePillClick(p.id)}
              disabled={disabled}
              aria-pressed={active}
              data-pill-key={p.id}
              title={disabled ? "No billing cycle for this tool" : p.id === "cycle" && globalCycleMode ? "Use per-app billing cycles" : undefined}
              className={cn(
                "relative z-10 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                disabled ? "opacity-50 hover:text-muted-foreground" : "",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </SliderPills>

      {isForecastPage ? <SafetyMarginEditor className="ml-2" /> : null}
    </div>
  );
}
