import { Buffer } from "node:buffer";

export interface TeamMember {
  name: string;
  email: string;
  id: string;
  role: string;
  isRemoved: boolean;
}

export interface RawDailyUsageEntry {
  day: string;
  userId: string;
  email: string;
  isActive: boolean;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  acceptedLinesAdded: number;
  acceptedLinesDeleted: number;
  totalApplies: number;
  totalAccepts: number;
  totalRejects: number;
  totalTabsShown: number;
  totalTabsAccepted: number;
  composerRequests: number;
  chatRequests: number;
  agentRequests: number;
  usageBasedReqs: number;
  mostUsedModel: string;
  tabMostUsedExtension: string;
  clientVersion?: string;
}

export interface DailyUsage {
  date: string;
  userId: string;
  email: string;
  isActive: boolean;
  linesAdded: number;
  linesDeleted: number;
  acceptedLinesAdded: number;
  acceptedLinesDeleted: number;
  totalApplies: number;
  totalAccepts: number;
  totalRejects: number;
  totalTabsShown: number;
  tabsAccepted: number;
  composerRequests: number;
  chatRequests: number;
  agentRequests: number;
  usageBasedReqs: number;
  mostUsedModel: string;
  tabMostUsedExtension: string;
  clientVersion: string;
}

export interface MemberSpend {
  userId: string;
  email: string;
  name: string;
  role: string;
  spendCents: number;
  includedSpendCents: number;
  fastPremiumRequests: number;
  monthlyLimitDollars: number | null;
  hardLimitOverrideDollars: number;
}

export interface SpendResponse {
  teamMemberSpend: MemberSpend[];
  subscriptionCycleStart: number;
  totalMembers: number;
  totalPages: number;
  limitedUsersCount: number;
  maxUserSpendCents: number;
}

export interface FilteredUsageEvent {
  timestamp: string;
  model: string;
  kind: string;
  maxMode: boolean;
  requestsCosts: number;
  isTokenBasedCall: boolean;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalCents: number;
  };
  userEmail: string;
  isChargeable: boolean;
  isHeadless: boolean;
}

export interface FilteredUsageEventsResponse {
  totalUsageEventsCount: number;
  pagination: {
    numPages: number;
    currentPage: number;
    pageSize: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  usageEvents: unknown[];
  period: { startDate: number; endDate: number };
}

export interface AnalyticsDAUEntry {
  date: string;
  dau: number;
  cli_dau: number;
  cloud_agent_dau: number;
  bugbot_dau: number;
}

export interface AnalyticsModelUsageEntry {
  date: string;
  model_breakdown: Record<string, { messages: number; users: number }>;
}

export interface AnalyticsAgentEditsEntry {
  event_date: string;
  total_suggested_diffs?: number;
  total_accepted_diffs?: number;
  total_rejected_diffs?: number;
  total_lines_accepted?: number;
  total_lines_suggested?: number;
}

export interface AnalyticsTabsEntry {
  event_date: string;
  total_suggestions?: number;
  total_accepts?: number;
  total_rejects?: number;
}

export interface AnalyticsMCPEntry {
  event_date: string;
  tool_name: string;
  mcp_server_name: string;
  usage: number;
}

export interface AnalyticsCommandsEntry {
  event_date: string;
  command_name: string;
  usage: number;
}

export interface AnalyticsPlansEntry {
  event_date: string;
  model: string;
  usage: number;
}

export interface AnalyticsFileExtensionsEntry {
  event_date: string;
  file_extension: string;
  total_files?: number;
  total_accepts?: number;
  total_rejects?: number;
}

export interface AnalyticsClientVersionsEntry {
  event_date: string;
  client_version: string;
  user_count: number;
  percentage: number;
}

export interface AICodeCommit {
  commitHash: string;
  repoName: string;
  userEmail: string;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  commitTs: string;
}

export interface GroupMemberSpend {
  userId: string;
  name: string;
  email: string;
  joinedAt: string;
  leftAt: string | null;
  spendCents: number;
  dailySpend: Array<{ date: string; spendCents: number }>;
}

export interface BillingGroup {
  id: string;
  name: string;
  type: string;
  memberCount: number;
  spendCents: number;
  currentMembers: GroupMemberSpend[];
}

export interface GroupsResponse {
  groups: BillingGroup[];
  unassignedGroup: BillingGroup;
  billingCycle?: { cycleStart: string; cycleEnd: string };
}

interface CursorClientOptions {
  apiKey: string;
  baseUrl?: string;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}

function str(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v !== "") return v;
    if (typeof v === "number" && !Number.isNaN(v)) return String(v);
  }
  return "";
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function normalizeFilteredUsageEvent(raw: Record<string, unknown>): FilteredUsageEvent {
  const tuRaw = raw.tokenUsage ?? raw.token_usage;
  let tokenUsage: FilteredUsageEvent["tokenUsage"];
  if (tuRaw && typeof tuRaw === "object") {
    const t = tuRaw as Record<string, unknown>;
    tokenUsage = {
      inputTokens: num(t.inputTokens ?? t.input_tokens),
      outputTokens: num(t.outputTokens ?? t.output_tokens),
      cacheWriteTokens: num(t.cacheWriteTokens ?? t.cache_write_tokens),
      cacheReadTokens: num(t.cacheReadTokens ?? t.cache_read_tokens),
      totalCents: num(t.totalCents ?? t.total_cents),
    };
  }
  return {
    timestamp: str(raw, "timestamp"),
    model: str(raw, "model"),
    kind: str(raw, "kind", "kindLabel", "kind_label"),
    maxMode: bool(raw.maxMode ?? raw.max_mode),
    requestsCosts: num(raw.requestsCosts ?? raw.requests_costs),
    isTokenBasedCall: bool(raw.isTokenBasedCall ?? raw.is_token_based_call),
    tokenUsage,
    userEmail: str(raw, "userEmail", "user_email", "email"),
    isChargeable: Boolean(raw.isChargeable ?? raw.is_chargeable),
    isHeadless: bool(raw.isHeadless ?? raw.is_headless),
  };
}

export class CursorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: CursorClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? process.env.CURSOR_API_BASE_URL ?? "https://api.cursor.com";
  }

  private async request<T>(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const { method = "GET", body } = options;
    const url = `${this.baseUrl}${endpoint}`;
    const credentials = Buffer.from(`${this.apiKey}:`).toString("base64");
    const headers: Record<string, string> = {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.request<T>(endpoint, options);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cursor API ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getTeamMembers(): Promise<TeamMember[]> {
    const data = await this.request<{ teamMembers: TeamMember[] }>("/teams/members");
    return data.teamMembers;
  }

  async getDailyUsage(options: { pageSize?: number; startDate?: number; endDate?: number } = {}): Promise<DailyUsage[]> {
    const allEntries: DailyUsage[] = [];
    let page = 1;
    const pageSize = options.pageSize ?? 100;

    while (true) {
      const body: Record<string, unknown> = { page, pageSize };
      if (options.startDate) body.startDate = options.startDate;
      if (options.endDate) body.endDate = options.endDate;

      const data = await this.request<{
        data: RawDailyUsageEntry[];
        pagination: {
          page: number;
          pageSize: number;
          totalUsers: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>("/teams/daily-usage-data", { method: "POST", body });

      for (const entry of data.data) {
        allEntries.push({
          date: entry.day,
          userId: entry.userId,
          email: entry.email,
          isActive: entry.isActive,
          linesAdded: entry.totalLinesAdded,
          linesDeleted: entry.totalLinesDeleted,
          acceptedLinesAdded: entry.acceptedLinesAdded,
          acceptedLinesDeleted: entry.acceptedLinesDeleted,
          totalApplies: entry.totalApplies,
          totalAccepts: entry.totalAccepts,
          totalRejects: entry.totalRejects,
          totalTabsShown: entry.totalTabsShown,
          tabsAccepted: entry.totalTabsAccepted,
          composerRequests: entry.composerRequests,
          chatRequests: entry.chatRequests,
          agentRequests: entry.agentRequests,
          usageBasedReqs: entry.usageBasedReqs,
          mostUsedModel: entry.mostUsedModel,
          tabMostUsedExtension: entry.tabMostUsedExtension,
          clientVersion: entry.clientVersion ?? "",
        });
      }

      if (!data.pagination.hasNextPage) break;
      page += 1;
    }

    return allEntries;
  }

  async getSpending(): Promise<{ members: MemberSpend[]; cycleStart: string; limitedUsersCount: number }> {
    const allMembers: MemberSpend[] = [];
    let cycleStart = "";
    let limitedUsersCount = 0;
    let page = 1;

    while (true) {
      const data = await this.request<SpendResponse>("/teams/spend", {
        method: "POST",
        body: { page, pageSize: 100 },
      });

      cycleStart = new Date(data.subscriptionCycleStart).toISOString().split("T")[0] ?? "";
      limitedUsersCount = data.limitedUsersCount ?? 0;
      allMembers.push(...data.teamMemberSpend);
      if (page >= data.totalPages) break;
      page += 1;
    }

    return { members: allMembers, cycleStart, limitedUsersCount };
  }

  async getBillingGroups(): Promise<GroupsResponse> {
    return this.request<GroupsResponse>("/teams/groups");
  }

  async getFilteredUsageEvents(options: {
    email?: string;
    startDate?: number;
    endDate?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ usageEvents: FilteredUsageEvent[]; pagination: FilteredUsageEventsResponse["pagination"] }> {
    const data = await this.request<FilteredUsageEventsResponse>("/teams/filtered-usage-events", {
      method: "POST",
      body: {
        email: options.email,
        startDate: options.startDate,
        endDate: options.endDate,
        page: options.page ?? 1,
        pageSize: options.pageSize ?? 500,
      },
    });
    const usageEvents = (data.usageEvents ?? []).map((row) =>
      normalizeFilteredUsageEvent(row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {}),
    );
    return { usageEvents, pagination: data.pagination };
  }

  private analyticsQuery(options: { startDate?: string; endDate?: string } = {}): string {
    const params = new URLSearchParams();
    params.set("startDate", options.startDate ?? "30d");
    params.set("endDate", options.endDate ?? "today");
    return params.toString();
  }

  async getAnalyticsDAU(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsDAUEntry[]> {
    const res = await this.request<{ data: AnalyticsDAUEntry[] }>(`/analytics/team/dau?${this.analyticsQuery(options)}`);
    return res.data;
  }

  async getAnalyticsModelUsage(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsModelUsageEntry[]> {
    const res = await this.request<{ data: AnalyticsModelUsageEntry[] }>(
      `/analytics/team/models?${this.analyticsQuery(options)}`,
    );
    return res.data;
  }

  async getAnalyticsAgentEdits(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsAgentEditsEntry[]> {
    const res = await this.request<{ data: AnalyticsAgentEditsEntry[] }>(
      `/analytics/team/agent-edits?${this.analyticsQuery(options)}`,
    );
    return res.data;
  }

  async getAnalyticsTabs(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsTabsEntry[]> {
    const res = await this.request<{ data: AnalyticsTabsEntry[] }>(`/analytics/team/tabs?${this.analyticsQuery(options)}`);
    return res.data;
  }

  async getAnalyticsMCP(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsMCPEntry[]> {
    const res = await this.request<{ data: AnalyticsMCPEntry[] }>(`/analytics/team/mcp?${this.analyticsQuery(options)}`);
    return res.data;
  }

  async getAnalyticsCommands(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsCommandsEntry[]> {
    const res = await this.request<{ data: AnalyticsCommandsEntry[] }>(
      `/analytics/team/commands?${this.analyticsQuery(options)}`,
    );
    return res.data;
  }

  async getAnalyticsPlans(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsPlansEntry[]> {
    const res = await this.request<{ data: AnalyticsPlansEntry[] }>(`/analytics/team/plans?${this.analyticsQuery(options)}`);
    return res.data;
  }

  async getAnalyticsFileExtensions(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsFileExtensionsEntry[]> {
    const res = await this.request<{ data: AnalyticsFileExtensionsEntry[] }>(
      `/analytics/team/top-file-extensions?${this.analyticsQuery(options)}`,
    );
    return res.data;
  }

  async getAnalyticsClientVersions(options: { startDate?: string; endDate?: string } = {}): Promise<AnalyticsClientVersionsEntry[]> {
    const res = await this.request<{ data: AnalyticsClientVersionsEntry[] }>(
      `/analytics/team/client-versions?${this.analyticsQuery(options)}`,
    );
    return res.data;
  }

  async getAICodeCommits(options: { startDate?: string; endDate?: string; page?: number; pageSize?: number } = {}): Promise<{
    items: AICodeCommit[];
    totalCount: number;
    page: number;
    pageSize: number;
  }> {
    const params = new URLSearchParams();
    params.set("startDate", options.startDate ?? "30d");
    params.set("endDate", options.endDate ?? "today");
    params.set("page", String(options.page ?? 1));
    params.set("pageSize", String(options.pageSize ?? 500));
    return this.request(`/analytics/ai-code/commits?${params.toString()}`);
  }
}

export function createCursorClient(apiKey?: string): CursorClient {
  const key = apiKey ?? process.env.CURSOR_ADMIN_API_KEY;
  if (!key) {
    throw new Error("CURSOR_ADMIN_API_KEY is required for Cursor API access");
  }
  return new CursorClient({ apiKey: key });
}
