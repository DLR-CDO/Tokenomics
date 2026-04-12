"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, UserCheck, Crown } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid, formatUsd, type KpiItem } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactNumber } from "@/lib/format";
import type { EnhancedMemberRow } from "@/server/metrics";

export function PeopleClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const [members, setMembers] = useState<EnhancedMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/metrics/ranked?source=cursor&${qs}&enhanced=true`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load ranked");
        if (!cancelled) setMembers(json.data as EnhancedMemberRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  const roleCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) {
      const r = m.role ?? "unknown";
      map.set(r, (map.get(r) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [members]);

  const kpis = useMemo<KpiItem[]>(() => {
    if (!members.length) return [];
    const activeMembers = members.filter((m) => m.requests > 0);
    const topSpender = [...members].sort((a, b) => b.windowSpendUsd - a.windowSpendUsd)[0];
    return [
      {
        label: "Total members",
        value: String(members.length),
        hint: "Distinct members seen in the window.",
        icon: Users,
        color: "var(--color-chart-1)",
      },
      {
        label: "Active members",
        value: String(activeMembers.length),
        hint: "Members with at least one request in the window.",
        icon: UserCheck,
        color: "var(--color-chart-2)",
      },
      {
        label: "Top spender",
        value: topSpender ? formatUsd(topSpender.windowSpendUsd) : "$0",
        hint: topSpender?.email ?? "No spend data",
        icon: Crown,
        color: "var(--color-chart-5)",
      },
    ];
  }, [members]);

  const columns = useMemo<ColumnDef<EnhancedMemberRow>[]>(
    () => [
      { accessorKey: "email", header: "Email" },
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "role",
        header: "Role",
        cell: (ctx) => {
          const val = ctx.getValue() as string | null;
          return val ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{val}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "linesAdded",
        header: "Lines +",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
      },
      {
        accessorKey: "linesDeleted",
        header: "Lines −",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
      },
      {
        accessorKey: "requests",
        header: "Requests",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
      },
      {
        id: "tabAcceptRate",
        header: "Tab Accept %",
        cell: (ctx) => {
          const row = ctx.row.original;
          if (!row.tabsShown || row.tabsShown === 0) return <span className="text-muted-foreground">—</span>;
          return `${((row.tabsAccepted / row.tabsShown) * 100).toFixed(1)}%`;
        },
      },
      {
        accessorKey: "windowSpendUsd",
        header: "Spend",
        cell: (ctx) => formatUsd(Number(ctx.getValue())),
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table integration
  const table = useReactTable({ data: members, columns, getCoreRowModel: getCoreRowModel() });

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-[320px] w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Could not load people data</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      {roleCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {roleCounts.map(([role, count]) => (
            <span key={role} className="rounded-full bg-surface-container px-3 py-1 text-xs font-medium text-foreground">
              {count} {role}
            </span>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>All members</CardTitle>
            <CardDescription>Enhanced view with role, lines deleted, and tab accept rate.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => downloadCsv(members)} disabled={members.length === 0}>
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                    No rows for this filter window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function downloadCsv(rows: EnhancedMemberRow[]) {
  const header = ["email", "name", "role", "lines_added", "lines_deleted", "requests", "tab_accept_rate", "window_spend_usd"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const tabRate = r.tabsShown > 0 ? ((r.tabsAccepted / r.tabsShown) * 100).toFixed(1) : "";
    lines.push([
      r.email ?? "",
      (r.name ?? "").replaceAll(",", " "),
      r.role ?? "",
      String(r.linesAdded),
      String(r.linesDeleted),
      String(r.requests),
      tabRate,
      String(r.windowSpendUsd),
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "members-enhanced.csv";
  a.click();
  URL.revokeObjectURL(url);
}
