"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, UserCheck } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactNumber } from "@/lib/format";
import type { EnhancedMemberRow } from "@/server/metrics";

export function ClaudeEnterprisePeopleClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "claude_enterprise";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [members, setMembers] = useState<EnhancedMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/metrics/ranked?${fullQs}&enhanced=true`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load ranked");
        if (!cancelled) setMembers(json.data as EnhancedMemberRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fullQs]);

  const kpis = useMemo<KpiItem[]>(() => {
    if (!members.length) return [];
    const activeMembers = members.filter((m) => m.requests > 0 || m.linesAdded > 0);
    return [
      { label: "Total members", value: String(members.length), icon: Users },
      {
        label: "Active in window",
        value: String(activeMembers.length),
        icon: UserCheck,
        color: "var(--color-chart-2)",
      },
    ];
  }, [members]);

  const columns = useMemo<ColumnDef<EnhancedMemberRow>[]>(
    () => [
      { accessorKey: "email", header: "Email" },
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "requests",
        header: "Messages",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
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
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: members,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

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

      <Card>
        <CardHeader>
          <CardTitle>All members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort();
                    const sorted = h.column.getIsSorted();
                    return (
                      <TableHead
                        key={h.id}
                        className={canSort ? "cursor-pointer select-none" : undefined}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {h.isPlaceholder ? null : (
                          <div className="flex items-center gap-1">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {canSort && (
                              <span className="text-muted-foreground/60">
                                {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}
                              </span>
                            )}
                          </div>
                        )}
                      </TableHead>
                    );
                  })}
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
                    No members for this filter window.
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
