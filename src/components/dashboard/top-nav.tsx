"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const PLATFORMS = [
  { id: "global", label: "Global" },
  { id: "cursor", label: "Cursor" },
  { id: "openai-enterprise", label: "OpenAI Enterprise" },
  { id: "openai-api", label: "OpenAI API" },
  { id: "azure", label: "Azure" },
] as const;

const TABS: Record<string, readonly { id: string; label: string }[]> = {
  global: [
    { id: "overview", label: "Overview" },
    { id: "forecast", label: "Forecast" },
  ],
  cursor: [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "cost", label: "Cost" },
    { id: "people", label: "People" },
    { id: "adoption", label: "Adoption" },
    { id: "forecast", label: "Forecast" },
  ],
  "openai-enterprise": [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "people", label: "People" },
    { id: "gpts", label: "GPTs" },
    { id: "projects", label: "Projects" },
    { id: "forecast", label: "Forecast" },
  ],
  "openai-api": [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "cost", label: "Cost" },
    { id: "people", label: "People" },
    { id: "forecast", label: "Forecast" },
  ],
  azure: [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "usage", label: "Usage" },
    { id: "cost", label: "Cost" },
    { id: "forecast", label: "Forecast" },
  ],
};

function resolvePlatformId(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const joined = segments.length >= 2 ? `${segments[0]}-${segments[1]}` : segments[0] ?? "";
  if (TABS[joined]) return joined;
  if (TABS[segments[0]]) return segments[0];
  return "global";
}

export function TopNav() {
  const pathname = usePathname();
  const currentPlatformId = resolvePlatformId(pathname);
  const currentTabs = TABS[currentPlatformId] || TABS.global;

  return (
    <div className="bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-4">
          <Link href="/global/overview" className="shrink-0 text-sm font-semibold tracking-tight">
            Token Dashboard
          </Link>

          <Link
            href="/settings"
            className={cn(
              "shrink-0 rounded-full p-2 transition-colors sm:hidden",
              pathname === "/settings" || pathname.startsWith("/settings/")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            aria-label="Settings"
          >
            <Settings className="h-4.5 w-4.5" />
          </Link>
        </div>

        {/* Tier 1: Platform Selector */}
        <nav className="flex flex-1 items-center justify-center overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 rounded-full bg-muted/60 p-1 min-w-max">
            {PLATFORMS.map((p) => {
              const active = currentPlatformId === p.id;
              const href = `/${p.id}/overview`;
              return (
                <Link
                  key={p.id}
                  href={href}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium transition-all",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <Link
          href="/settings"
          className={cn(
            "hidden shrink-0 rounded-full p-2 transition-colors sm:block",
            pathname === "/settings" || pathname.startsWith("/settings/")
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          aria-label="Settings"
        >
          <Settings className="h-4.5 w-4.5" />
        </Link>
      </div>

      {/* Tier 2: Contextual Tabs */}
      <div className="border-t border-border/40">
        <div className="mx-auto flex max-w-7xl items-center px-4">
          <nav className="flex items-center gap-6 overflow-x-auto no-scrollbar py-2">
            {currentTabs.map((t) => {
              const href = `/${currentPlatformId}/${t.id}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={t.id}
                  href={href}
                  className={cn(
                    "whitespace-nowrap border-b-2 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
