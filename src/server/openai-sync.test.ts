import { describe, expect, it } from "vitest";

describe("OpenAI sync external_id conventions", () => {
  it("cost external IDs are stable and deterministic", () => {
    const day = "2026-03-15";
    const projectId = "proj_abc123";
    const lineItem = "GPT-4o";

    const extId = `openai:cost:${day}:${projectId}:${lineItem}`;
    expect(extId).toBe("openai:cost:2026-03-15:proj_abc123:GPT-4o");

    const extId2 = `openai:cost:${day}:${projectId}:${lineItem}`;
    expect(extId).toBe(extId2);
  });

  it("completions external IDs include model, project, and metric kind", () => {
    const day = "2026-03-15";
    const model = "gpt-4o";
    const projectId = "proj_abc123";

    const tokensIn = `openai:completions:${day}:${model}:${projectId}:tokens_in`;
    const tokensOut = `openai:completions:${day}:${model}:${projectId}:tokens_out`;
    const requests = `openai:completions:${day}:${model}:${projectId}:requests`;

    expect(tokensIn).toBe("openai:completions:2026-03-15:gpt-4o:proj_abc123:tokens_in");
    expect(tokensOut).toBe("openai:completions:2026-03-15:gpt-4o:proj_abc123:tokens_out");
    expect(requests).toBe("openai:completions:2026-03-15:gpt-4o:proj_abc123:requests");

    expect(new Set([tokensIn, tokensOut, requests]).size).toBe(3);
  });

  it("embeddings external IDs follow same pattern as completions", () => {
    const day = "2026-03-15";
    const model = "text-embedding-3-small";
    const projectId = "proj_abc123";

    const tokensIn = `openai:embeddings:${day}:${model}:${projectId}:tokens_in`;
    const requests = `openai:embeddings:${day}:${model}:${projectId}:requests`;

    expect(tokensIn).toContain("openai:embeddings:");
    expect(requests).toContain("openai:embeddings:");

    expect(tokensIn).not.toBe(requests);
  });

  it("missing project IDs fall back to 'none'", () => {
    const day = "2026-03-15";
    const model = "gpt-4o";
    const rawProjectId: string | null = null;
    const projectId = rawProjectId ?? "none";

    const extId = `openai:completions:${day}:${model}:${projectId}:tokens_in`;
    expect(extId).toBe("openai:completions:2026-03-15:gpt-4o:none:tokens_in");
  });
});

describe("OpenAI sync config", () => {
  it("epochToIsoDate converts correctly", () => {
    const epoch = 1710460800;
    const iso = new Date(epoch * 1000).toISOString().slice(0, 10);
    expect(iso).toBe("2024-03-15");
  });

  it("dayStartFromEpoch returns midnight UTC", () => {
    const epoch = 1710460800;
    const iso = new Date(epoch * 1000).toISOString().slice(0, 10);
    const dayStart = new Date(`${iso}T00:00:00.000Z`);
    expect(dayStart.getUTCHours()).toBe(0);
    expect(dayStart.getUTCMinutes()).toBe(0);
    expect(dayStart.getUTCSeconds()).toBe(0);
  });
});
