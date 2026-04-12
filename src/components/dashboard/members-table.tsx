"use client";

import { useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactNumber, formatUsd } from "@/lib/format";
import type { RankedMemberRow } from "@/server/metrics";

function toCsv(rows: RankedMemberRow[]): string {
  const header = ["email", "name", "lines_added", "requests", "window_spend_usd"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.email ?? "",
        (r.name ?? "").replaceAll(",", " "),
        String(r.linesAdded),
        String(r.requests),
        String(r.windowSpendUsd),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function MembersTable({ rows, title, description }: { rows: RankedMemberRow[]; title: string; description?: string }) {
  const columns = useMemo<ColumnDef<RankedMemberRow>[]>(
    () => [
      { accessorKey: "email", header: "Email" },
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "linesAdded",
        header: "Lines added",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
      },
      {
        accessorKey: "requests",
        header: "Requests",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
      },
      {
        accessorKey: "windowSpendUsd",
        header: "Window spend",
        cell: (ctx) => formatUsd(Number(ctx.getValue())),
      },
    ],
    [],
  );

  // TanStack Table returns unstable function references; safe here because rows drive rerenders.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table integration
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  function downloadCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "members.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={downloadCsv} disabled={rows.length === 0}>
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
  );
}
