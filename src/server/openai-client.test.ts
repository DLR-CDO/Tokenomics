import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAIClient } from "./openai-client";

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe("OpenAIClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: OpenAIClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new OpenAIClient({ apiKey: "sk-admin-test", orgId: "org-test" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Bearer auth and org header", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ object: "page", data: [], has_more: false, next_page: null }),
    );

    await client.getCosts({ startTime: 1700000000 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/organization/costs");
    expect(init.headers.Authorization).toBe("Bearer sk-admin-test");
    expect(init.headers["OpenAI-Organization"]).toBe("org-test");
  });

  it("paginates costs with has_more + next_page", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          object: "page",
          data: [{ object: "bucket", start_time: 1700000000, end_time: 1700086400, results: [] }],
          has_more: true,
          next_page: "cursor_abc",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          object: "page",
          data: [{ object: "bucket", start_time: 1700086400, end_time: 1700172800, results: [] }],
          has_more: false,
          next_page: null,
        }),
      );

    const buckets = await client.getCosts({ startTime: 1700000000 });
    expect(buckets).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const secondUrl = mockFetch.mock.calls[1]![0] as string;
    expect(secondUrl).toContain("page=cursor_abc");
  });

  it("retries on 429 with Retry-After", async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(
        jsonResponse({ object: "page", data: [], has_more: false, next_page: null }),
      );

    const promise = client.getCosts({ startTime: 1700000000 });
    await vi.advanceTimersByTimeAsync(1100);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws on non-OK non-429 responses", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Forbidden" }, 403));

    await expect(client.getCosts({ startTime: 1700000000 })).rejects.toThrow("OpenAI API 403");
  });

  it("paginates listUsers with after cursor", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ object: "organization.user", id: "u1", email: "a@test.com", name: "A", role: "owner", added_at: 0 }],
          has_more: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [{ object: "organization.user", id: "u2", email: "b@test.com", name: "B", role: "reader", added_at: 0 }],
          has_more: false,
        }),
      );

    const users = await client.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0]!.email).toBe("a@test.com");
    expect(users[1]!.email).toBe("b@test.com");

    const secondUrl = mockFetch.mock.calls[1]![0] as string;
    expect(secondUrl).toContain("after=u1");
  });

  it("fetches completions usage with groupBy", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        object: "page",
        data: [
          {
            object: "bucket",
            start_time: 1700000000,
            end_time: 1700086400,
            results: [
              {
                object: "organization.usage.completions.result",
                input_tokens: 1000,
                output_tokens: 500,
                num_model_requests: 10,
                model: "gpt-4o",
                project_id: "proj_1",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    );

    const buckets = await client.getCompletionsUsage({
      startTime: 1700000000,
      groupBy: ["model", "project_id"],
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.results[0]!.input_tokens).toBe(1000);

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("group_by=model");
    expect(url).toContain("group_by=project_id");
  });
});
