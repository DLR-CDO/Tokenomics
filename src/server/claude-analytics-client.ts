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
