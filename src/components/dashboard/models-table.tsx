"use client";

import { useMemo } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactNumber } from "@/lib/format";
import type { ModelRow } from "@/server/metrics";

function toCsv(rows: ModelRow[]): string {
  const header = ["model", "messages"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push([r.model.replaceAll(",", " "), String(r.requests)].join(","));
  return lines.join("\n");
}

export function ModelsTable({ rows }: { rows: ModelRow[] }) {
  const columns = useMemo<ColumnDef<ModelRow>[]>(
    () => [
      { accessorKey: "model", header: "Model" },
      {
        accessorKey: "requests",
        header: "Messages (analytics)",
        cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table integration
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Model mix</CardTitle>
          <CardDescription>From Cursor analytics model usage (team-level breakdown).</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => download(rows)} disabled={rows.length === 0}>
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
                <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                  No model usage rows for this window.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function download(rows: ModelRow[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "models.csv";
  a.click();
  URL.revokeObjectURL(url);
}
