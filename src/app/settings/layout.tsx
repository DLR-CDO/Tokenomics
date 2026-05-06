"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "", label: "Overview" },
  { id: "cursor", label: "Cursor" },
  { id: "openai-api", label: "OpenAI API" },
  { id: "openai-enterprise", label: "OpenAI Enterprise" },
  { id: "claude-enterprise", label: "Claude Enterprise" },
  { id: "azure", label: "Azure" },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-background">
      {/* Minimal top bar */}
      <div className="bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link
            href="/global/overview"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold tracking-tight">Settings</h1>
          </div>
        </div>

        {/* Section tabs */}
        <div className="border-t border-border/40">
          <div className="mx-auto flex max-w-7xl items-center px-4">
            <nav className="flex items-center gap-6 overflow-x-auto no-scrollbar py-2">
              {SECTIONS.map((s) => {
                const href = s.id ? `/settings/${s.id}` : "/settings";
                const active = s.id
                  ? pathname === href || pathname.startsWith(`${href}/`)
                  : pathname === "/settings";
                return (
                  <Link
                    key={s.id || "overview"}
                    href={href}
                    className={cn(
                      "whitespace-nowrap border-b-2 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
