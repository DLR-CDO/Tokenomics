"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, UserCheck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";

type MemberRow = {
  memberId: string | null;
  email: string | null;
  name: string | null;
  role: string | null;
  requests: number;
  windowSpendUsd: number;
};

const USER_COLUMNS: ColumnDef<MemberRow>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "role", header: "Role" },
  { 
    accessorKey: "requests", 
    header: "Requests", 
    cell: (ctx) => formatCompactNumber(Number(ctx.getValue())),
  },
];

export function OpenAIPeopleClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const fullQs = qs ? `${qs}&source=openai` : `source=openai`;

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/metrics/ranked?roster=true&${fullQs}`, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) throw new Error(json.error ?? "Failed to load members");

        if (!cancelled) {
          setMembers(json.data as MemberRow[]);
        }
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">OpenAI People</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const activeUsers = members.filter((m) => m.requests > 0).length;

  const kpis: KpiItem[] = [
    {
      label: "Org Members",
      value: String(members.length),
      icon: Users,
    },
    {
      label: "Active (in period)",
      value: String(activeUsers),
      icon: UserCheck,
    },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />
      
      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold tracking-tight">All Org Members</h3>
        <DataTable columns={USER_COLUMNS} data={members} />
      </div>
    </div>
  );
}
