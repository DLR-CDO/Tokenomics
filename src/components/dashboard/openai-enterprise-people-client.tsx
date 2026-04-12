"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Users, UserCheck, UserMinus, Clock } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber } from "@/lib/format";

interface CsvUser {
  email: string;
  name: string;
  role: string;
  userRole: string;
  userStatus: string;
  messages: number;
  creditsUsed: number;
  lastDayActiveDate: string;
  gptMessages?: number;
  projectMessages?: number;
  projectsCreated?: number;
  firstDayActive?: string;
  createdOrInvitedDate?: string;
}

interface DbMember {
  email: string;
  name: string;
  credits: number;
  requests: number;
}

interface MergedUser {
  name: string;
  email: string;
  status: string;
  role: string;
  messages: number;
  credits: number;
  gptMessages: number;
  projectMessages: number;
  firstActive: string;
  lastActive: string;
}

function formatCredits(v: number): string {
  if (v === 0) return "—";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(1);
}

function daysBetween(a: string, b: string): number | null {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function OpenAIEnterprisePeopleClient() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const source = "openai_enterprise";
  const fullQs = qs ? `${qs}&source=${source}` : `source=${source}`;

  const [users, setUsers] = useState<MergedUser[]>([]);
  const [avgActivation, setAvgActivation] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [settingsRes, rosterRes] = await Promise.all([
          fetch("/api/settings/enterprise-users", { cache: "no-store" }),
          fetch(`/api/metrics/ranked?dimension=member&${fullQs}`, { cache: "no-store" }),
        ]);

        const settingsJson = settingsRes.ok ? await settingsRes.json() : null;
        const rosterJson = await rosterRes.json();

        if (cancelled) return;

        const csvUsers: CsvUser[] = (settingsJson?.users ?? []) as CsvUser[];
        const dbMembers: DbMember[] = ((rosterJson.data ?? []) as DbMember[]);

        const dbByEmail = new Map<string, DbMember>();
        for (const m of dbMembers) {
          if (m.email) dbByEmail.set(m.email.toLowerCase(), m);
        }

        const csvByEmail = new Map<string, CsvUser>();
        for (const u of csvUsers) {
          if (u.email) csvByEmail.set(u.email.toLowerCase(), u);
        }

        const allEmails = new Set([...dbByEmail.keys(), ...csvByEmail.keys()]);
        const merged: MergedUser[] = [];
        const activationDays: number[] = [];

        for (const email of allEmails) {
          const csv = csvByEmail.get(email);
          const db = dbByEmail.get(email);

          const hasActivity = (db?.credits ?? 0) > 0 || (db?.requests ?? 0) > 0 || (csv?.messages ?? 0) > 0;
          const csvStatus = csv?.userStatus?.toLowerCase() ?? "";

          let status: string;
          if (hasActivity) {
            status = "enabled";
          } else if (csvStatus === "enabled" || csvStatus === "active") {
            status = "enabled";
          } else if (csvStatus === "pending") {
            status = "pending";
          } else {
            status = db ? "invited" : "unknown";
          }

          if (csv?.createdOrInvitedDate && csv?.firstDayActive) {
            const d = daysBetween(csv.createdOrInvitedDate, csv.firstDayActive);
            if (d !== null && d >= 0) activationDays.push(d);
          }

          merged.push({
            name: csv?.name || db?.name || "",
            email,
            status,
            role: csv?.role ?? "",
            messages: csv?.messages ?? 0,
            credits: db?.credits ?? csv?.creditsUsed ?? 0,
            gptMessages: Number(csv?.gptMessages ?? 0),
            projectMessages: Number(csv?.projectMessages ?? 0),
            firstActive: csv?.firstDayActive ?? "",
            lastActive: csv?.lastDayActiveDate ?? "",
          });
        }

        merged.sort((a, b) => b.credits - a.credits || b.messages - a.messages);
        setUsers(merged);
        setAvgActivation(
          activationDays.length > 0
            ? Math.round(activationDays.reduce((s, d) => s + d, 0) / activationDays.length)
            : null,
        );
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs]);

  const roleDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of users) {
      const r = u.role || "Unknown";
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [users]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === "enabled").length;
  const pendingUsers = users.filter(u => u.status === "pending").length;

  const kpis: KpiItem[] = [
    { label: "Total Members", value: String(totalUsers), icon: Users },
    { label: "Active", value: String(activeUsers), icon: UserCheck },
    { label: "Pending", value: String(pendingUsers), icon: UserMinus },
  ];

  if (avgActivation !== null) {
    kpis.push({
      label: "Avg Time to Activate",
      value: `${avgActivation}d`,
      icon: Clock,
    });
  }

  const USER_COLUMNS: ColumnDef<MergedUser, unknown>[] = [
    { accessorKey: "name", header: "Name" },
    { accessorKey: "email", header: "Email" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = String(getValue());
        return (
          <span className={
            s === "enabled" ? "text-emerald-600 dark:text-emerald-400" :
            s === "pending" ? "text-amber-600 dark:text-amber-400" :
            "text-muted-foreground"
          }>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        );
      },
    },
    { accessorKey: "role", header: "Role" },
    {
      accessorKey: "messages",
      header: "Messages",
      cell: ({ getValue }) => {
        const v = Number(getValue());
        return v > 0 ? formatCompactNumber(v) : "—";
      },
    },
    {
      accessorKey: "credits",
      header: "Credits",
      cell: ({ getValue }) => formatCredits(Number(getValue())),
    },
    {
      accessorKey: "gptMessages",
      header: "GPT Msgs",
      cell: ({ getValue }) => {
        const v = Number(getValue());
        return v > 0 ? formatCompactNumber(v) : "—";
      },
    },
    {
      accessorKey: "projectMessages",
      header: "Project Msgs",
      cell: ({ getValue }) => {
        const v = Number(getValue());
        return v > 0 ? formatCompactNumber(v) : "—";
      },
    },
    { accessorKey: "firstActive", header: "First Active" },
    { accessorKey: "lastActive", header: "Last Active" },
  ];

  return (
    <div className="space-y-6">
      <KpiGrid items={kpis} />

      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold tracking-tight">All Members</h3>
        <DataTable columns={USER_COLUMNS} data={users} />
      </div>

      {roleDistribution.length > 0 && (
        <HorizontalBarChart
          title="Role Distribution"
          data={roleDistribution}
          formatValue={formatCompactNumber}
        />
      )}
    </div>
  );
}
