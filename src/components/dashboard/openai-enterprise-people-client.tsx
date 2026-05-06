"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Users, UserCheck, UserMinus, Clock, AlertTriangle, DollarSign } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { KpiGrid, type KpiItem } from "@/components/dashboard/kpi-grid";
import { HorizontalBarChart } from "@/components/dashboard/horizontal-bar-chart";
import { DataTable } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, formatCredits as formatCreditsBase, formatUsd } from "@/lib/format";
import {
  computeEnterpriseCreditRates,
  hasAnyCreditRate,
  valuateCredits,
  type EnterpriseCreditRates,
} from "@/lib/enterprise-credits";

const formatCredits = (v: number): string => formatCreditsBase(v, { emptyDash: true, suffix: "" });

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

interface AllocationData {
  configured: boolean;
  creditPoolConfigured?: boolean;
  overageRateConfigured?: boolean;
  freeCreditsPerSeatPerMonth?: number;
  costPerOverageCreditUsd?: number;
  monthlyAllocation?: number;
  monthlyCreditAllocation?: number;
  seatCount?: number;
}

interface NameWithCreditTooltipProps {
  name: string;
  credits: number;
  rates: EnterpriseCreditRates;
  windowCaveat?: boolean;
}

function NameWithCreditTooltip({ name, credits, rates, windowCaveat }: NameWithCreditTooltipProps) {
  const valuation = valuateCredits(credits, rates);
  const showOverage = valuation.overageUsd !== undefined;
  const showImplied = valuation.impliedUsd !== undefined;
  const showAny = showOverage || showImplied;
  const displayName = name?.trim() ? name : "—";

  if (!showAny) {
    return <span>{displayName}</span>;
  }

  return (
    <span className="group/name relative inline-block focus-within:z-50">
      <span tabIndex={0} className="outline-none">
        {displayName}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border/60 bg-popover p-2 text-xs shadow-lg opacity-0 transition-opacity group-hover/name:visible group-hover/name:opacity-100 group-focus-within/name:visible group-focus-within/name:opacity-100 motion-reduce:transition-none"
      >
        <div className="font-medium">{formatCreditsBase(credits, { suffix: "" })} credits used</div>
        {showOverage ? (
          <div className="text-muted-foreground">
            ≈ {formatUsd(valuation.overageUsd ?? 0)} if charged at overage
          </div>
        ) : null}
        {showImplied ? (
          <div className="text-muted-foreground">
            ~ {formatUsd(valuation.impliedUsd ?? 0)} contract value
          </div>
        ) : null}
        {windowCaveat ? (
          <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            for the selected window
          </div>
        ) : null}
      </span>
    </span>
  );
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
  const [allocation, setAllocation] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [settingsRes, rosterRes, allocRes] = await Promise.all([
          fetch("/api/settings/enterprise-users", { cache: "no-store" }),
          fetch(`/api/metrics/ranked?dimension=member&${fullQs}`, { cache: "no-store" }),
          fetch(`/api/metrics/monthly-allocation?source=${source}`, { cache: "no-store" }),
        ]);

        const settingsJson = settingsRes.ok ? await settingsRes.json() : null;
        const rosterJson = await rosterRes.json();
        const allocJson = allocRes.ok ? await allocRes.json() : null;

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
        if (allocJson) setAllocation(allocJson as AllocationData);
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fullQs, source]);

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

  const allowance =
    allocation?.creditPoolConfigured && (allocation.freeCreditsPerSeatPerMonth ?? 0) > 0
      ? (allocation.freeCreditsPerSeatPerMonth ?? 0)
      : null;
  const overageRate =
    allocation?.overageRateConfigured && (allocation.costPerOverageCreditUsd ?? 0) > 0
      ? (allocation.costPerOverageCreditUsd ?? 0)
      : null;

  const overQuotaCount = allowance != null ? users.filter((u) => u.credits > allowance).length : 0;
  const totalUserOverage =
    allowance != null && overageRate != null
      ? users.reduce((sum, u) => sum + Math.max(0, u.credits - allowance) * overageRate, 0)
      : 0;

  const creditRates = computeEnterpriseCreditRates({
    monthlyDollarAllocation: allocation?.monthlyAllocation,
    monthlyCreditAllocation: allocation?.monthlyCreditAllocation,
    costPerOverageCreditUsd: allocation?.costPerOverageCreditUsd,
  });
  const ratesAvailable = hasAnyCreditRate(creditRates);
  const datePreset = searchParams.get("datePreset");
  const windowCaveat = ratesAvailable && datePreset !== null && datePreset !== "cycle";

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

  if (allowance != null) {
    kpis.push({
      label: "Over-quota",
      value: String(overQuotaCount),
      hint: `Members above ${formatCompactNumber(allowance)} credits / month allowance`,
      icon: AlertTriangle,
      color: overQuotaCount > 0 ? "var(--color-destructive)" : undefined,
    });
  }

  if (overageRate != null && totalUserOverage > 0) {
    kpis.push({
      label: "User-level overage",
      value: formatUsd(totalUserOverage),
      hint: `Sum of per-user credits above allowance × ${formatUsd(overageRate)}/credit. Chargeback view; actual billing pools at the org level.`,
      icon: DollarSign,
      color: "var(--color-destructive)",
    });
  }

  const USER_COLUMNS: ColumnDef<MergedUser, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <NameWithCreditTooltip
          name={row.original.name}
          credits={row.original.credits}
          rates={creditRates}
          windowCaveat={windowCaveat}
        />
      ),
    },
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
      id: "allowancePct",
      header: "% of allowance",
      accessorFn: (row) => (allowance != null && allowance > 0 ? (row.credits / allowance) * 100 : -1),
      cell: ({ row }) => {
        if (allowance == null || allowance <= 0) {
          return <span className="text-muted-foreground">—</span>;
        }
        const pct = (row.original.credits / allowance) * 100;
        const cls =
          pct >= 100
            ? "text-destructive font-semibold"
            : pct >= 80
              ? "text-amber-600 dark:text-amber-400 font-medium"
              : "text-muted-foreground";
        return <span className={cls}>{pct.toFixed(0)}%</span>;
      },
    },
    {
      id: "overageCost",
      header: "Overage cost",
      accessorFn: (row) =>
        allowance != null && overageRate != null
          ? Math.max(0, row.credits - allowance) * overageRate
          : -1,
      cell: ({ row }) => {
        if (allowance == null || overageRate == null) {
          return <span className="text-muted-foreground">—</span>;
        }
        const cost = Math.max(0, row.original.credits - allowance) * overageRate;
        if (cost <= 0) return <span className="text-muted-foreground">—</span>;
        return <span className="font-medium text-destructive">{formatUsd(cost)}</span>;
      },
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
