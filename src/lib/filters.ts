import { z } from "zod";

export const sourceSystemSchema = z.enum([
  "cursor",
  "openai",
  "azure",
  "openai_enterprise",
  "claude_enterprise",
]);
export type SourceSystem = z.infer<typeof sourceSystemSchema>;

export const dashboardFiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  model: z.string().optional(),
  memberId: z.string().optional(),
  billingGroup: z.string().optional(),
});

export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export function parseDashboardFilters(searchParams: URLSearchParams): DashboardFilters {
  return dashboardFiltersSchema.parse({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    model: searchParams.get("model") ?? undefined,
    memberId: searchParams.get("memberId") ?? undefined,
    billingGroup: searchParams.get("billingGroup") ?? undefined,
  });
}

export function filtersToQueryString(filters: Partial<DashboardFilters>): string {
  const p = new URLSearchParams();
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  if (filters.model) p.set("model", filters.model);
  if (filters.memberId) p.set("memberId", filters.memberId);
  if (filters.billingGroup) p.set("billingGroup", filters.billingGroup);
  return p.toString();
}
