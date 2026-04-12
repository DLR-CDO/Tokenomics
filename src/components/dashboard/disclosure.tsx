"use client";

import { useState, type ReactNode, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export function Disclosure({
  title,
  defaultOpen = false,
  badge,
  children,
  persistKey,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string | number;
  children: ReactNode;
  persistKey?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (persistKey) {
      const saved = localStorage.getItem(`disclosure-${persistKey}`);
      if (saved !== null) {
        setOpen(saved === "true");
      }
    }
  }, [persistKey]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (persistKey) {
      localStorage.setItem(`disclosure-${persistKey}`, String(next));
    }
  };

  return (
    <div className="rounded-2xl bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge != null && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {badge}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
