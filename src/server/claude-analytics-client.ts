/* ---------- Response types ---------- */

export interface AnalyticsOfficeMetrics {
  distinct_session_count: number;
  message_count: number;
  skills_used_count: number;
  distinct_skills_used_count: number;
  connectors_used_count: number;
  distinct_connectors_used_count: number;
}

export interface AnalyticsCoworkMetrics {
  distinct_session_count: number;
  message_count: number;
  action_count: number;
  dispatch_turn_count: number;
  skills_used_count: number;
  distinct_skills_used_count: number;
  connectors_used_count: number;
  distinct_connectors_used_count: number;
}

export interface AnalyticsChatMetrics {
  distinct_conversation_count: number;
  message_count: number;
  distinct_projects_created_count: number;
  distinct_projects_used_count: number;
  distinct_files_uploaded_count: number;
  distinct_artifacts_created_count: number;
  distinct_shared_artifacts_viewed_count: number;
  thinking_message_count: number;
  distinct_skills_used_count: number;
  connectors_used_count: number;
  shared_conversations_viewed_count: number;
}

export interface AnalyticsToolAction {
  accepted_count: number;
  rejected_count: number;
}

export interface AnalyticsToolActions {
  edit_tool?: AnalyticsToolAction;
  multi_edit_tool?: AnalyticsToolAction;
  write_tool?: AnalyticsToolAction;
  notebook_edit_tool?: AnalyticsToolAction;
}

export interface AnalyticsClaudeCodeMetrics {
  core_metrics: {
    commit_count: number;
    pull_request_count: number;
    lines_of_code: { added_count: number; removed_count: number };
    distinct_session_count: number;
  };
  tool_actions: AnalyticsToolActions;
}

export interface AnalyticsDesignMetrics {
  distinct_session_count: number;
  distinct_projects_used_count: number;
  distinct_projects_created_count: number;
  message_count: number;
}

export interface AnalyticsUser {
  user: {
    id: string;
    email_address: string;
  };
  chat_metrics: AnalyticsChatMetrics;
  claude_code_metrics: AnalyticsClaudeCodeMetrics;
  office_metrics: {
    excel: AnalyticsOfficeMetrics;
    powerpoint: AnalyticsOfficeMetrics;
    word?: AnalyticsOfficeMetrics;
  };
  cowork_metrics: AnalyticsCoworkMetrics;
  design_metrics?: AnalyticsDesignMetrics;
  web_search_count: number;
}

export interface AnalyticsSummary {
  starting_at: string;
  ending_at: string;
  daily_active_user_count: number;
  weekly_active_user_count: number;
  monthly_active_user_count: number;
  assigned_seat_count: number;
  pending_invite_count: number;
  cowork_daily_active_user_count: number;
  cowork_weekly_active_user_count: number;
  cowork_monthly_active_user_count: number;
  daily_adoption_rate?: number;
  weekly_adoption_rate?: number;
  monthly_adoption_rate?: number;
}

/** The `/summaries` endpoint is the odd one out — returns {summaries: [...]} with no pagination. */
export interface SummariesResponse {
  summaries: AnalyticsSummary[];
}

export interface AnalyticsProject {
  project_name: string;
  project_id: string;
  distinct_user_count: number;
  distinct_conversation_count: number;
  message_count: number;
  created_at: string;
  created_by: { id: string; email_address: string };
}

export interface AnalyticsSkill {
  skill_name: string;
  distinct_user_count: number;
  chat_metrics: { distinct_conversation_skill_used_count: number };
  claude_code_metrics: { distinct_session_skill_used_count: number };
  office_metrics: {
    excel: { distinct_session_skill_used_count: number };
    powerpoint: { distinct_session_skill_used_count: number };
  };
  cowork_metrics: { distinct_session_skill_used_count: number };
}

export interface AnalyticsConnector {
  connector_name: string;
  distinct_user_count: number;
  chat_metrics: { distinct_conversation_connector_used_count: number };
  claude_code_metrics: { distinct_session_connector_used_count: number };
  office_metrics: {
    excel: { distinct_session_connector_used_count: number };
    powerpoint: { distinct_session_connector_used_count: number };
  };
  cowork_metrics: { distinct_session_connector_used_count: number };
}

export interface PagedResponse<T> {
  data: T[];
  /** Some analytics endpoints omit `has_more` entirely and only use `next_page`. */
  has_more?: boolean;
  next_page: string | null;
}

/* ---------- Cost / Usage report types (beta) ---------- */

export type CostUsageProduct =
  | "chat"
  | "claude_code"
  | "cowork"
  | "office_agent"
  | "claude_in_chrome"
  | "claude_design";

export type ContextWindow = "0-200k" | "200k-1M";
export type InferenceGeo = "global" | "us" | "not_available";
export type InferenceSpeed = "fast" | "standard";

export interface UserActor {
  type: "user_actor";
  user_id: string;
  name: string | null;
  email: string | null;
  deleted?: boolean;
}

export interface CacheCreationTokens {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}

export interface ServerToolUse {
  web_search_requests?: number;
}

/** One row from `/user_usage_report`. Dimension fields are non-null when group_by[] includes them. */
export interface UserUsageRow {
  actor: UserActor;
  product: CostUsageProduct | null;
  model: string | null;
  context_window: ContextWindow | null;
  inference_geo: InferenceGeo | null;
  speed: InferenceSpeed | null;
  uncached_input_tokens?: number;
  cache_creation?: CacheCreationTokens;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  server_tool_use?: ServerToolUse;
  requests?: number;
}

/** One row from `/user_cost_report`. */
export interface UserCostRow {
  actor: UserActor;
  product: CostUsageProduct | null;
  model: string | null;
  context_window: ContextWindow | null;
  inference_geo: InferenceGeo | null;
  speed: InferenceSpeed | null;
  currency: "USD";
  /** Decimal string of fractional cents — divide by 100 for USD. */
  amount: string;
  list_amount: string;
  cost_type: "tokens" | "web_search" | "code_execution" | null;
  token_type: string | null;
  requests?: number;
}

export interface UsageBucketResult {
  product: CostUsageProduct | null;
  model: string | null;
  context_window: ContextWindow | null;
  inference_geo: InferenceGeo | null;
  speed: InferenceSpeed | null;
  uncached_input_tokens?: number;
  cache_creation?: CacheCreationTokens;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  server_tool_use?: ServerToolUse;
}

/** One row from `/usage_report`: a time bucket containing one or more group results. */
export interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: UsageBucketResult[];
}

export interface CostBucketResult {
  product: CostUsageProduct | null;
  model: string | null;
  context_window: ContextWindow | null;
  inference_geo: InferenceGeo | null;
  speed: InferenceSpeed | null;
  cost_type: "tokens" | "web_search" | "code_execution" | null;
  token_type: string | null;
  currency: "USD";
  amount: string;
  list_amount: string;
}

/** One row from `/cost_report`. */
export interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: CostBucketResult[];
}

export interface UserUsageReportQuery {
  startingAt: string;
  endingAt: string;
  products?: CostUsageProduct[];
  models?: string[];
  userIds?: string[];
  contextWindows?: ContextWindow[];
  inferenceGeos?: InferenceGeo[];
  speeds?: InferenceSpeed[];
  groupBy?: Array<"product" | "model" | "context_window" | "inference_geo" | "speed">;
  orderBy?: "total_tokens" | "output_tokens" | "uncached_input_tokens";
  excludeDeletedUsers?: boolean;
  order?: "desc" | "asc";
  limit?: number;
}

export interface UserCostReportQuery {
  startingAt: string;
  endingAt: string;
  products?: CostUsageProduct[];
  models?: string[];
  userIds?: string[];
  contextWindows?: ContextWindow[];
  inferenceGeos?: InferenceGeo[];
  speeds?: InferenceSpeed[];
  groupBy?: Array<
    "product" | "model" | "context_window" | "inference_geo" | "speed" | "cost_type" | "token_type"
  >;
  orderBy?: "amount" | "list_amount";
  excludeDeletedUsers?: boolean;
  order?: "desc" | "asc";
  limit?: number;
}

export interface UsageReportQuery {
  startingAt: string;
  endingAt: string;
  bucketWidth?: "1m" | "1h" | "1d";
  groupBy?: Array<"product" | "model" | "context_window" | "inference_geo" | "speed">;
  products?: CostUsageProduct[];
  models?: string[];
  userIds?: string[];
  contextWindows?: ContextWindow[];
  inferenceGeos?: InferenceGeo[];
  speeds?: InferenceSpeed[];
  limit?: number;
}

export interface CostReportQuery {
  startingAt: string;
  endingAt: string;
  bucketWidth?: "1m" | "1h" | "1d";
  groupBy?: Array<
    "product" | "model" | "context_window" | "inference_geo" | "speed" | "cost_type" | "token_type"
  >;
  products?: CostUsageProduct[];
  models?: string[];
  userIds?: string[];
  contextWindows?: ContextWindow[];
  inferenceGeos?: InferenceGeo[];
  speeds?: InferenceSpeed[];
  limit?: number;
}

/* ---------- Client ---------- */

interface ClaudeAnalyticsClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class ClaudeAnalyticsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: ClaudeAnalyticsClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";
  }

  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, { method: "GET", headers });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.request<T>(endpoint);
    }

    if (response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const retry = await fetch(url, { method: "GET", headers });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`Anthropic Analytics API ${retry.status}: ${text}`);
      }
      return retry.json() as Promise<T>;
    }

    if (!response.ok) {
      const text = await response.text();
      // 400 usually indicates invalid date / pre-2026 — caller should log and skip.
      throw new ClaudeAnalyticsError(response.status, `Anthropic Analytics API ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private async paginateByDate<T>(
    path: string,
    date: string,
    limit: number,
  ): Promise<T[]> {
    const all: T[] = [];
    let page: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("date", date);
      params.set("limit", String(limit));
      if (page) params.set("page", page);

      const res = await this.request<PagedResponse<T>>(`${path}?${params.toString()}`);
      const data = Array.isArray(res?.data) ? res.data : [];
      all.push(...data);
      if (!res?.next_page) break;
      page = res.next_page;
    }
    return all;
  }

  async listUsers(date: string, limit = 1000): Promise<AnalyticsUser[]> {
    return this.paginateByDate<AnalyticsUser>("/organizations/analytics/users", date, limit);
  }

  /** /summaries uses its own envelope `{summaries: [...]}` and does not paginate — single request per range. */
  async listSummaries(startingDate: string, endingDate?: string): Promise<AnalyticsSummary[]> {
    const params = new URLSearchParams();
    params.set("starting_date", startingDate);
    if (endingDate) params.set("ending_date", endingDate);

    const res = await this.request<SummariesResponse>(
      `/organizations/analytics/summaries?${params.toString()}`,
    );
    return Array.isArray(res?.summaries) ? res.summaries : [];
  }

  async listChatProjects(date: string, limit = 1000): Promise<AnalyticsProject[]> {
    return this.paginateByDate<AnalyticsProject>(
      "/organizations/analytics/apps/chat/projects",
      date,
      limit,
    );
  }

  async listSkills(date: string, limit = 1000): Promise<AnalyticsSkill[]> {
    return this.paginateByDate<AnalyticsSkill>("/organizations/analytics/skills", date, limit);
  }

  async listConnectors(date: string, limit = 1000): Promise<AnalyticsConnector[]> {
    return this.paginateByDate<AnalyticsConnector>(
      "/organizations/analytics/connectors",
      date,
      limit,
    );
  }

  /* ---------- Cost / Usage report endpoints (beta) ---------- */

  /**
   * Page through `/user_usage_report`. Yields one row per user (one per
   * group when `groupBy` is set). Caller is responsible for chunking ranges
   * larger than 31 days via `chunkRange31d`.
   */
  async *listUserUsageReport(opts: UserUsageReportQuery): AsyncGenerator<UserUsageRow> {
    const params = buildCostUsageParams({
      starting_at: opts.startingAt,
      ending_at: opts.endingAt,
      "products[]": opts.products,
      "models[]": opts.models,
      "user_ids[]": opts.userIds,
      "context_windows[]": opts.contextWindows,
      "inference_geos[]": opts.inferenceGeos,
      "speeds[]": opts.speeds,
      "group_by[]": opts.groupBy,
      order_by: opts.orderBy,
      exclude_deleted_users: opts.excludeDeletedUsers,
      order: opts.order,
      limit: opts.limit ?? 1000,
    });
    yield* this.paginateCostUsage<UserUsageRow>(
      "/organizations/analytics/user_usage_report",
      params,
    );
  }

  /** Page through `/user_cost_report`. */
  async *listUserCostReport(opts: UserCostReportQuery): AsyncGenerator<UserCostRow> {
    const params = buildCostUsageParams({
      starting_at: opts.startingAt,
      ending_at: opts.endingAt,
      "products[]": opts.products,
      "models[]": opts.models,
      "user_ids[]": opts.userIds,
      "context_windows[]": opts.contextWindows,
      "inference_geos[]": opts.inferenceGeos,
      "speeds[]": opts.speeds,
      "group_by[]": opts.groupBy,
      order_by: opts.orderBy,
      exclude_deleted_users: opts.excludeDeletedUsers,
      order: opts.order,
      limit: opts.limit ?? 1000,
    });
    yield* this.paginateCostUsage<UserCostRow>(
      "/organizations/analytics/user_cost_report",
      params,
    );
  }

  /** Page through `/usage_report`. Yields one bucket per iteration. */
  async *listUsageReport(opts: UsageReportQuery): AsyncGenerator<UsageBucket> {
    // limit defaults differ by bucket_width: 1d→7 (max 31), 1h→24 (max 168), 1m→60 (max 256)
    const bucket = opts.bucketWidth ?? "1d";
    const defaultLimit = bucket === "1d" ? 31 : bucket === "1h" ? 168 : 256;
    const params = buildCostUsageParams({
      starting_at: opts.startingAt,
      ending_at: opts.endingAt,
      bucket_width: bucket,
      "group_by[]": opts.groupBy,
      "products[]": opts.products,
      "models[]": opts.models,
      "user_ids[]": opts.userIds,
      "context_windows[]": opts.contextWindows,
      "inference_geos[]": opts.inferenceGeos,
      "speeds[]": opts.speeds,
      limit: opts.limit ?? defaultLimit,
    });
    yield* this.paginateCostUsage<UsageBucket>(
      "/organizations/analytics/usage_report",
      params,
    );
  }

  /** Page through `/cost_report`. */
  async *listCostReport(opts: CostReportQuery): AsyncGenerator<CostBucket> {
    const bucket = opts.bucketWidth ?? "1d";
    const defaultLimit = bucket === "1d" ? 31 : bucket === "1h" ? 168 : 256;
    const params = buildCostUsageParams({
      starting_at: opts.startingAt,
      ending_at: opts.endingAt,
      bucket_width: bucket,
      "group_by[]": opts.groupBy,
      "products[]": opts.products,
      "models[]": opts.models,
      "user_ids[]": opts.userIds,
      "context_windows[]": opts.contextWindows,
      "inference_geos[]": opts.inferenceGeos,
      "speeds[]": opts.speeds,
      limit: opts.limit ?? defaultLimit,
    });
    yield* this.paginateCostUsage<CostBucket>(
      "/organizations/analytics/cost_report",
      params,
    );
  }

  /**
   * Cursor pagination for cost+usage endpoints.
   *
   * Anthropic requires the cursor be passed back unchanged with identical
   * query parameters. We send the same `URLSearchParams` on every page and
   * append/replace only `page=`. If the API returns 400/410 on a stale
   * cursor (e.g. from a long-lived job), we throw — the caller should
   * restart from the first page.
   */
  private async *paginateCostUsage<T>(
    path: string,
    baseParams: URLSearchParams,
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    while (true) {
      const params = new URLSearchParams(baseParams.toString());
      if (cursor) params.set("page", cursor);

      const res = await this.request<PagedResponse<T>>(`${path}?${params.toString()}`);
      const rows = Array.isArray(res?.data) ? res.data : [];
      for (const row of rows) yield row;
      if (!res?.next_page) return;
      cursor = res.next_page;
    }
  }
}

/* ---------- Cost / Usage helpers ---------- */

const FRACTIONAL_CENT_USD_DIVISOR = 100;

/**
 * Parse a fractional-cent decimal string (e.g. "41280.000000") to USD.
 * Per the API spec: amounts are decimal strings denominated in cents, divide by 100 for USD.
 *
 * Precision note: JS `Number.parseFloat` provides ~15 significant digits; this
 * is safe up to roughly $90B. Above that range, prefer a decimal library to
 * avoid losing precision. For our usage volumes this is comfortably below the
 * danger threshold.
 */
export function parseFractionalCentUsd(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return n / FRACTIONAL_CENT_USD_DIVISOR;
}

/**
 * Split [startIso, endIso] into adjacent windows of at most 31 days each
 * (the per-query maximum imposed by the cost+usage endpoints). Inputs and
 * outputs are RFC 3339 datetimes. The last window's `endingAt` matches the
 * caller's `endIso`.
 */
export function chunkRange31d(
  startIso: string,
  endIso: string,
): Array<{ startingAt: string; endingAt: string }> {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const MAX_MS = 31 * 24 * 60 * 60 * 1000;
  const windows: Array<{ startingAt: string; endingAt: string }> = [];
  let cursor = start;
  while (cursor < end) {
    const next = Math.min(cursor + MAX_MS, end);
    windows.push({
      startingAt: new Date(cursor).toISOString(),
      endingAt: new Date(next).toISOString(),
    });
    cursor = next;
  }
  return windows;
}

/**
 * Build a URLSearchParams from a record where bracketed keys (e.g. "products[]")
 * map to arrays of values. Repeats the bracketed key for each entry, matching
 * the Anthropic spec: `products[]=chat&products[]=claude_code`.
 *
 * Skips null/undefined and empty arrays. Booleans serialize as "true"/"false".
 * Numbers serialize via toString. Strings pass through.
 */
function buildCostUsageParams(
  shape: Record<string, string | number | boolean | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(shape)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v == null || v === "") continue;
        params.append(key, String(v));
      }
      continue;
    }
    if (typeof value === "boolean") {
      params.set(key, value ? "true" : "false");
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}

export class ClaudeAnalyticsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ClaudeAnalyticsError";
  }
}

export function createClaudeAnalyticsClient(apiKey?: string): ClaudeAnalyticsClient {
  const key = apiKey ?? process.env.CLAUDE_ANALYTICS_API_KEY;
  if (!key) {
    throw new Error("CLAUDE_ANALYTICS_API_KEY is required for Claude Enterprise Analytics API access");
  }
  return new ClaudeAnalyticsClient({ apiKey: key });
}
