"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ProbeRequest =
  | { ok: true; status: number; durationMs: number }
  | { ok: false; status: number; durationMs: number; error: string };

type ProbeResult = {
  endpoint: string;
  url: string;
  request: ProbeRequest;
  dataRefreshedAt?: string;
  rowCount?: number;
  hasMore?: boolean;
  sampleRow?: unknown;
  unknownFields?: string[];
  totals?: Record<string, number | string>;
};

type ProbeResponse = {
  window: { startingAt: string; endingAt: string };
  probes: ProbeResult[];
  notes: string[];
};

const ENDPOINT_LABELS: Record<string, string> = {
  user_usage_report: "Per-user token usage",
  user_cost_report: "Per-user USD cost",
  usage_report: "Bucketed token usage",
  cost_report: "Bucketed USD cost",
};

export function ClaudeEnterpriseReconCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProbeResponse | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function runProbe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sync/claude-enterprise/probe", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : null) ??
            `Probe failed (HTTP ${res.status})`,
        );
      }
      setData(json as ProbeResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost &amp; usage API recon</CardTitle>
        <CardDescription>
          Diagnostic probe for Anthropic&apos;s beta cost and usage endpoints. Read-only; makes no DB writes. Run this
          once to confirm the API key has access and to inspect the response shape before enabling the cost+tokens
          sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={runProbe} disabled={loading}>
            {loading ? "Probing..." : "Run probe"}
          </Button>
          {data ? (
            <span className="text-xs text-muted-foreground">
              Window: <code className="rounded bg-muted px-1 py-0.5">{data.window.startingAt}</code> →{" "}
              <code className="rounded bg-muted px-1 py-0.5">{data.window.endingAt}</code>
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="space-y-2">
              {data.probes.map((p) => {
                const label = ENDPOINT_LABELS[p.endpoint] ?? p.endpoint;
                const ok = p.request.ok;
                const isOpen = Boolean(open[p.endpoint]);
                return (
                  <div key={p.endpoint} className="rounded-md border">
                    <button
                      type="button"
                      onClick={() => setOpen((prev) => ({ ...prev, [p.endpoint]: !prev[p.endpoint] }))}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`inline-block h-2 w-2 rounded-full ${
                            ok ? "bg-green-500" : "bg-destructive"
                          }`}
                        />
                        <span className="font-medium">{label}</span>
                        <code className="text-xs text-muted-foreground">{p.endpoint}</code>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>HTTP {p.request.status}</span>
                        <span>{p.request.durationMs}ms</span>
                        {ok && typeof p.rowCount === "number" ? <span>{p.rowCount} rows</span> : null}
                        {p.unknownFields && p.unknownFields.length > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                            {p.unknownFields.length} unknown
                          </span>
                        ) : null}
                        <span>{isOpen ? "−" : "+"}</span>
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="space-y-3 border-t px-3 py-3 text-xs">
                        {!ok ? (
                          <div>
                            <div className="font-medium text-destructive">Error</div>
                            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2">
                              {(p.request as Extract<ProbeRequest, { ok: false }>).error}
                            </pre>
                          </div>
                        ) : null}
                        {p.dataRefreshedAt ? (
                          <div>
                            <span className="text-muted-foreground">data_refreshed_at:</span>{" "}
                            <code>{p.dataRefreshedAt}</code>
                          </div>
                        ) : null}
                        {p.totals && Object.keys(p.totals).length > 0 ? (
                          <div>
                            <div className="text-muted-foreground">Sample totals</div>
                            <ul className="mt-1 grid grid-cols-2 gap-x-4">
                              {Object.entries(p.totals).map(([k, v]) => (
                                <li key={k}>
                                  <code className="text-muted-foreground">{k}:</code>{" "}
                                  <span className="font-medium">
                                    {typeof v === "number" ? v.toLocaleString() : String(v)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {p.unknownFields && p.unknownFields.length > 0 ? (
                          <div>
                            <div className="text-amber-700 dark:text-amber-300">
                              Unknown fields (beta-API drift candidates)
                            </div>
                            <code className="mt-1 block rounded bg-muted p-2">
                              {p.unknownFields.join(", ")}
                            </code>
                          </div>
                        ) : null}
                        {p.sampleRow ? (
                          <div>
                            <div className="text-muted-foreground">First row</div>
                            <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted p-2">
                              {JSON.stringify(p.sampleRow, null, 2)}
                            </pre>
                          </div>
                        ) : (
                          <div className="text-muted-foreground">No rows in window.</div>
                        )}
                        <div className="text-muted-foreground">
                          <span>URL:</span> <code className="break-all">{p.url}</code>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Click <strong>Run probe</strong> to query each endpoint with a 7-day sample window ending at{" "}
            <code className="rounded bg-muted px-1 py-0.5">today − 4d</code>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
