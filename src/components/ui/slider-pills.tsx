"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface IndicatorState {
  left: number;
  width: number;
  ready: boolean;
}

interface SliderPillsProps {
  /** Stable id of the currently active pill. Children mark themselves with `data-pill-key`. */
  activeKey: string | null | undefined;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Pill-group container that renders an animated background indicator behind the
 * child whose `data-pill-key` attribute matches `activeKey`.
 *
 * Children should:
 *   - Set `data-pill-key="<id>"` on the actual interactive element (button or link).
 *   - Use `relative z-10` so they paint above the indicator.
 *   - NOT set their own `bg-background` on the active state; the indicator handles
 *     the active visual. They may still toggle text color (e.g. `text-foreground`
 *     vs `text-muted-foreground`).
 */
export function SliderPills({ activeKey, className, ariaLabel, children }: SliderPillsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorState>({ left: 0, width: 0, ready: false });

  const measure = (): IndicatorState | null => {
    const container = containerRef.current;
    if (!container || !activeKey) return null;
    const target = container.querySelector<HTMLElement>(`[data-pill-key="${cssEscape(activeKey)}"]`);
    if (!target) return null;
    return { left: target.offsetLeft, width: target.offsetWidth, ready: true };
  };

  // useLayoutEffect runs synchronously before paint so the indicator is in the
  // correct position the first time the user sees it.
  useLayoutEffect(() => {
    const next = measure();
    if (next) setIndicator(next);
    else setIndicator((s) => ({ ...s, ready: false }));
    // We intentionally re-measure when activeKey changes; children identity
    // (e.g. a re-render of the parent) doesn't affect pill geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure closes over refs
  }, [activeKey]);

  // Re-measure on container/pill resize so font load or container width changes
  // keep the indicator aligned.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const next = measure();
      if (next) setIndicator(next);
    });
    ro.observe(container);
    container.querySelectorAll<HTMLElement>("[data-pill-key]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure closes over refs
  }, []);

  return (
    <div
      ref={containerRef}
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn("relative flex items-center gap-1 rounded-full bg-muted/60 p-1", className)}
    >
      {indicator.ready && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 z-0 rounded-full bg-background shadow-sm transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {children}
    </div>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
