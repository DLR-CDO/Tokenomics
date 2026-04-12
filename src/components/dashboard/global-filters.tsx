"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatISO, format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";

function toInputDate(d: Date): string {
  return formatISO(d, { representation: "date" });
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

export function GlobalFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateOpen, setDateOpen] = useState(false);

  const pushFilters = useCallback(
    (f: string, t: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const p = new URLSearchParams();
        p.set("from", f);
        p.set("to", t);
        const model = searchParams.get("model");
        const memberId = searchParams.get("memberId");
        if (model) p.set("model", model);
        if (memberId) p.set("memberId", memberId);
        router.push(`${pathname}?${p.toString()}`);
      }, 300);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString());
    let changed = false;

    if (!p.get("from")) {
      p.set("from", toInputDate(new Date(Date.now() - 30 * 86400000)));
      changed = true;
    }
    if (!p.get("to")) {
      p.set("to", toInputDate(new Date()));
      changed = true;
    }

    if (changed) {
      router.replace(`${pathname}?${p.toString()}`);
      return;
    }

    /* eslint-disable react-hooks/set-state-in-effect -- syncing controlled inputs to Next.js searchParams */
    setFrom(p.get("from") ?? "");
    setTo(p.get("to") ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname, router, searchParams]);

  const handleFromChange = (val: string) => {
    setFrom(val);
    if (val && to) pushFilters(val, to);
  };

  const handleToChange = (val: string) => {
    setTo(val);
    if (from && val) pushFilters(from, val);
  };

  return (
    <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2">
      {/* Date range chip */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setDateOpen(!dateOpen); }}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {from && to ? formatRange(from, to) : "Select dates"}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
          {dateOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 flex gap-2 rounded-xl bg-card p-3 shadow-lg">
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
          )}
        </div>
    </div>
  );
}
