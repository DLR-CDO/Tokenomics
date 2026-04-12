/* ---------- Response types ---------- */

export interface CostsBucket {
  object: "bucket";
  start_time: number;
  end_time: number;
  results: CostsResultItem[];
}

export interface CostsResultItem {
  object: string;
  amount?: { value: number; currency: string };
  line_item?: string | null;
  project_id?: string | null;
}

export interface CompletionsResultItem {
  object: "organization.usage.completions.result";
  input_tokens: number;
  output_tokens: number;
  num_model_requests: number;
  input_cached_tokens?: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
  model?: string | null;
  project_id?: string | null;
  user_id?: string | null;
  api_key_id?: string | null;
  batch?: boolean;
  service_tier?: string | null;
}

export interface EmbeddingsResultItem {
  object: "organization.usage.embeddings.result";
  input_tokens: number;
  num_model_requests: number;
  model?: string | null;
  project_id?: string | null;
  user_id?: string | null;
  api_key_id?: string | null;
}

export interface ImagesResultItem {
  object: "organization.usage.images.result";
  images: number;
  num_model_requests: number;
  model?: string | null;
  project_id?: string | null;
  user_id?: string | null;
  size?: string | null;
  source?: string | null;
}

export interface AudioSpeechesResultItem {
  object: "organization.usage.audio_speeches.result";
  characters: number;
  num_model_requests: number;
  model?: string | null;
  project_id?: string | null;
  user_id?: string | null;
}

export interface AudioTranscriptionsResultItem {
  object: "organization.usage.audio_transcriptions.result";
  seconds: number;
  num_model_requests: number;
  model?: string | null;
  project_id?: string | null;
  user_id?: string | null;
}

export interface ModerationsResultItem {
  object: "organization.usage.moderations.result";
  input_tokens: number;
  num_model_requests: number;
  model?: string | null;
  project_id?: string | null;
  user_id?: string | null;
}

export interface VectorStoresResultItem {
  object: "organization.usage.vector_stores.result";
  usage_bytes: number;
  project_id?: string | null;
}

export interface CodeInterpreterSessionsResultItem {
  object: "organization.usage.code_interpreter_sessions.result";
  num_sessions: number;
  project_id?: string | null;
}

export interface UsageBucket<T> {
  object: "bucket";
  start_time: number;
  end_time: number;
  results: T[];
}

export interface PageResponse<T> {
  object: "page";
  data: T[];
  has_more: boolean;
  next_page: string | null;
}

export interface OrgUser {
  object: "organization.user" | "organization.project.user";
  id: string;
  email: string;
  name: string;
  role: string;
  added_at: number;
}

export interface ProjectUser {
  object: "organization.project.user";
  id: string;
  email: string;
  name: string;
  role: string;
  added_at: number;
}

export interface OrgProject {
  object: "organization.project";
  id: string;
  name: string;
  created_at: number;
  archived_at: number | null;
  status: string;
}

type CostsGroupBy = "project_id" | "line_item";
type CompletionsGroupBy = "project_id" | "user_id" | "api_key_id" | "model" | "batch" | "service_tier";

/* ---------- Client ---------- */

interface OpenAIClientOptions {
  apiKey: string;
  orgId?: string;
  baseUrl?: string;
}

export class OpenAIClient {
  private readonly apiKey: string;
  private readonly orgId: string | undefined;
  private readonly baseUrl: string;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.orgId = options.orgId;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.orgId) {
      headers["OpenAI-Organization"] = this.orgId;
    }

    const response = await fetch(url, { method: "GET", headers });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.request<T>(endpoint);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /* ---- Costs ---- */

  async getCosts(options: {
    startTime: number;
    endTime?: number;
    groupBy?: CostsGroupBy[];
    limit?: number;
  }): Promise<CostsBucket[]> {
    const all: CostsBucket[] = [];
    let page: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("start_time", String(options.startTime));
      if (options.endTime) params.set("end_time", String(options.endTime));
      params.set("bucket_width", "1d");
      params.set("limit", String(options.limit ?? 180));
      if (options.groupBy) {
        for (const g of options.groupBy) params.append("group_by", g);
      }
      if (page) params.set("page", page);

      const res = await this.request<PageResponse<CostsBucket>>(
        `/organization/costs?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
    return all;
  }

  /* ---- Completions usage ---- */

  async getCompletionsUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: CompletionsGroupBy[];
    limit?: number;
  }): Promise<UsageBucket<CompletionsResultItem>[]> {
    const all: UsageBucket<CompletionsResultItem>[] = [];
    let page: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("start_time", String(options.startTime));
      if (options.endTime) params.set("end_time", String(options.endTime));
      params.set("bucket_width", "1d");
      params.set("limit", String(options.limit ?? 31));
      if (options.groupBy) {
        for (const g of options.groupBy) params.append("group_by", g);
      }
      if (page) params.set("page", page);

      const res = await this.request<PageResponse<UsageBucket<CompletionsResultItem>>>(
        `/organization/usage/completions?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
    return all;
  }

  /* ---- Embeddings usage ---- */

  async getEmbeddingsUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("model" | "project_id")[];
    limit?: number;
  }): Promise<UsageBucket<EmbeddingsResultItem>[]> {
    const all: UsageBucket<EmbeddingsResultItem>[] = [];
    let page: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("start_time", String(options.startTime));
      if (options.endTime) params.set("end_time", String(options.endTime));
      params.set("bucket_width", "1d");
      params.set("limit", String(options.limit ?? 31));
      if (options.groupBy) {
        for (const g of options.groupBy) params.append("group_by", g);
      }
      if (page) params.set("page", page);

      const res = await this.request<PageResponse<UsageBucket<EmbeddingsResultItem>>>(
        `/organization/usage/embeddings?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
    return all;
  }

  /* ---- Images usage ---- */

  async getImagesUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("model" | "project_id" | "user_id" | "size" | "source")[];
    limit?: number;
  }): Promise<UsageBucket<ImagesResultItem>[]> {
    return this.paginateUsage<ImagesResultItem>("/organization/usage/images", options);
  }

  /* ---- Audio speeches usage ---- */

  async getAudioSpeechesUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("model" | "project_id" | "user_id")[];
    limit?: number;
  }): Promise<UsageBucket<AudioSpeechesResultItem>[]> {
    return this.paginateUsage<AudioSpeechesResultItem>("/organization/usage/audio_speeches", options);
  }

  /* ---- Audio transcriptions usage ---- */

  async getAudioTranscriptionsUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("model" | "project_id" | "user_id")[];
    limit?: number;
  }): Promise<UsageBucket<AudioTranscriptionsResultItem>[]> {
    return this.paginateUsage<AudioTranscriptionsResultItem>("/organization/usage/audio_transcriptions", options);
  }

  /* ---- Moderations usage ---- */

  async getModerationsUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("model" | "project_id" | "user_id")[];
    limit?: number;
  }): Promise<UsageBucket<ModerationsResultItem>[]> {
    return this.paginateUsage<ModerationsResultItem>("/organization/usage/moderations", options);
  }

  /* ---- Vector stores usage ---- */

  async getVectorStoresUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("project_id")[];
    limit?: number;
  }): Promise<UsageBucket<VectorStoresResultItem>[]> {
    return this.paginateUsage<VectorStoresResultItem>("/organization/usage/vector_stores", options);
  }

  /* ---- Code interpreter sessions ---- */

  async getCodeInterpreterSessionsUsage(options: {
    startTime: number;
    endTime?: number;
    groupBy?: ("project_id")[];
    limit?: number;
  }): Promise<UsageBucket<CodeInterpreterSessionsResultItem>[]> {
    return this.paginateUsage<CodeInterpreterSessionsResultItem>("/organization/usage/code_interpreter_sessions", options);
  }

  /* ---- Generic paginated usage fetcher ---- */

  private async paginateUsage<T>(
    endpoint: string,
    options: { startTime: number; endTime?: number; groupBy?: string[]; limit?: number },
  ): Promise<UsageBucket<T>[]> {
    const all: UsageBucket<T>[] = [];
    let page: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("start_time", String(options.startTime));
      if (options.endTime) params.set("end_time", String(options.endTime));
      params.set("bucket_width", "1d");
      params.set("limit", String(options.limit ?? 31));
      if (options.groupBy) {
        for (const g of options.groupBy) params.append("group_by", g);
      }
      if (page) params.set("page", page);

      const res = await this.request<PageResponse<UsageBucket<T>>>(
        `${endpoint}?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
    return all;
  }

  /* ---- Users ---- */

  async listUsers(): Promise<OrgUser[]> {
    const all: OrgUser[] = [];
    let after: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (after) params.set("after", after);

      const res = await this.request<{ object: string; data: OrgUser[]; has_more: boolean; last_id?: string }>(
        `/organization/users?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more) break;
      const last = res.data[res.data.length - 1];
      if (!last) break;
      after = last.id;
    }
    return all;
  }

  /* ---- Project Users ---- */

  async listProjectUsers(projectId: string): Promise<ProjectUser[]> {
    const all: ProjectUser[] = [];
    let after: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (after) params.set("after", after);

      const res = await this.request<{ object: string; data: ProjectUser[]; has_more: boolean; last_id?: string }>(
        `/organization/projects/${projectId}/users?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more) break;
      const last = res.data[res.data.length - 1];
      if (!last) break;
      after = last.id;
    }
    return all;
  }

  /* ---- Projects ---- */

  async listProjects(): Promise<OrgProject[]> {
    const all: OrgProject[] = [];
    let after: string | undefined;

    while (true) {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (after) params.set("after", after);

      const res = await this.request<{ object: string; data: OrgProject[]; has_more: boolean; last_id?: string }>(
        `/organization/projects?${params.toString()}`,
      );
      all.push(...res.data);
      if (!res.has_more) break;
      const last = res.data[res.data.length - 1];
      if (!last) break;
      after = last.id;
    }
    return all;
  }
}

export function createOpenAIClient(apiKey?: string): OpenAIClient {
  const key = apiKey ?? process.env.OPENAI_ADMIN_API_KEY ?? process.env.OPENAI_ADMIN_KEY;
  if (!key) {
    throw new Error("OPENAI_ADMIN_API_KEY is required for OpenAI API access");
  }
  return new OpenAIClient({
    apiKey: key,
    orgId: process.env.OPENAI_ORG_ID,
  });
}
