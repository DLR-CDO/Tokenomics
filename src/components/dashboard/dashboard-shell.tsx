import { Suspense } from "react";

import { GlobalFilters } from "./global-filters";
import { TopNav } from "./top-nav";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <TopNav />
      <div className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-2 text-sm text-muted-foreground">Loading filters…</div>}>
          <GlobalFilters />
        </Suspense>
      </div>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
