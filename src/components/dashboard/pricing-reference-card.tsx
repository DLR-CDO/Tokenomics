"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface PricingRow {
  model: string;
  category: string;
  tier: "standard" | "batch" | "flex" | "priority";
  context: "short" | "long";
  modality?: "audio" | "text" | "image";
  inputUsdPerMtok?: number;
  cachedInputUsdPerMtok?: number;
  outputUsdPerMtok?: number;
  unit?: string;
  notes?: string;
}

interface ApiResponse {
  parsedAt: string | null;
  verifiedAt: string | null;
  status: "ok" | "empty" | "parse_error";
  upstream: { parsedAt: string | null; status: string; rows: PricingRow[]; rawMdx?: string | null; error?: string };
  overrides: { verifiedAt: string | null; rows: PricingRow[] };
  effective: { parsedAt: string | null; verifiedAt: string | null; status: string; rows: PricingRow[] };
}

const CATEGORY_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "flagship", label: "Flagship" },
  { key: "specialized", label: "Specialized" },
  { key: "realtime", label: "Realtime" },
  { key: "image", label: "Image" },
  { key: "video", label: "Video" },
  { key: "transcription", label: "Transcription" },
  { key: "embeddings", label: "Embeddings" },
  { key: "moderation", label: "Moderation" },
  { key: "finetune", label: "Finetune" },
  { key: "tools", label: "Tools" },
  { key: "storage", label: "Storage" },
];

function rowKey(r: Pick<PricingRow, "model" | "tier" | "context" | "modality">): string {
  return `${r.model}::${r.tier}::${r.context}::${r.modality ?? ""}`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatRate(value: number | undefined): string {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

type EditableField = "inputUsdPerMtok" | "cachedInputUsdPerMtok" | "outputUsdPerMtok";

export function PricingReferenceCard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Map<string, Partial<PricingRow>>>(new Map());

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/openai-pricing", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse | { error?: string };
      if (!res.ok) {
        setError("error" in json ? (json.error ?? "Failed to load pricing") : "Failed to load pricing");
        return;
      }
      setData(json as ApiResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refetch();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  // Open paste box automatically when there's no source loaded yet.
  useEffect(() => {
    if (!loading && data && (data.effective.rows.length === 0 || data.status === "empty")) {
      setPasteOpen(true);
    }
  }, [loading, data]);

  const overrideMap = useMemo(() => {
    const m = new Map<string, PricingRow>();
    for (const r of data?.overrides.rows ?? []) m.set(rowKey(r), r);
    return m;
  }, [data]);

  const upstreamMap = useMemo(() => {
    const m = new Map<string, PricingRow>();
    for (const r of data?.upstream.rows ?? []) m.set(rowKey(r), r);
    return m;
  }, [data]);

  const effectiveRows = useMemo(() => {
    const rows = data?.effective.rows ?? [];
    if (filter === "all") return rows;
    return rows.filter((r) => r.category === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.effective.rows ?? []) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [data]);

  function getDisplayValue(row: PricingRow, field: EditableField): number | undefined {
    const k = rowKey(row);
    const edit = edits.get(k);
    if (edit && field in edit) return edit[field];
    return row[field];
  }

  function isOverriddenField(row: PricingRow, field: EditableField): boolean {
    const k = rowKey(row);
    const override = overrideMap.get(k);
    const upstream = upstreamMap.get(k);
    const edited = edits.get(k)?.[field] !== undefined;
    if (edited) return true;
    if (!override) return false;
    return override[field] !== undefined && override[field] !== upstream?.[field];
  }

  function isTokenRow(row: PricingRow): boolean {
    return row.unit === undefined || row.unit === "1M_tokens";
  }

  function setEdit(row: PricingRow, field: EditableField, raw: string) {
    const k = rowKey(row);
    setEdits((prev) => {
      const next = new Map(prev);
      const current = { ...(next.get(k) ?? {}) };
      if (raw === "") {
        delete current[field];
      } else {
        const n = Number(raw);
        if (Number.isFinite(n)) current[field] = n;
      }
      if (Object.keys(current).length === 0) next.delete(k);
      else next.set(k, current);
      return next;
    });
  }

  function resetRow(row: PricingRow) {
    const k = rowKey(row);
    const upstream = upstreamMap.get(k);
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(k, {
        inputUsdPerMtok: upstream?.inputUsdPerMtok,
        cachedInputUsdPerMtok: upstream?.cachedInputUsdPerMtok,
        outputUsdPerMtok: upstream?.outputUsdPerMtok,
      });
      return next;
    });
  }

  async function parseAndSave() {
    if (!sourceText.trim()) {
      setError("Paste the OpenAI pricing page MDX before parsing.");
      return;
    }
    setParsing(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/openai-pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceText }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        source?: { rowCount?: number; status?: string; error?: string };
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Parse failed");
      } else if (json.ok === false) {
        setError(json.source?.error ?? "Parse failed; previous rows preserved.");
      } else {
        setMessage(`Parsed ${json.source?.rowCount ?? 0} rows from pasted source.`);
        setSourceText("");
        setPasteOpen(false);
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function saveOverrides() {
    if (!data) return;
    setSavingOverrides(true);
    setMessage(null);
    setError(null);
    try {
      const overrides: PricingRow[] = [];
      const seenKeys = new Set<string>();

      for (const [k, edit] of edits.entries()) {
        const baseRow = data.effective.rows.find((r) => rowKey(r) === k);
        if (!baseRow) continue;
        const upstream = upstreamMap.get(k);
        const merged: PricingRow = { ...baseRow, ...edit };
        const fields: EditableField[] = ["inputUsdPerMtok", "cachedInputUsdPerMtok", "outputUsdPerMtok"];
        const differs = fields.some((f) => merged[f] !== upstream?.[f]);
        if (differs) {
          overrides.push(merged);
          seenKeys.add(k);
        }
      }

      // Preserve existing overrides that weren't edited in this session.
      for (const r of data.overrides.rows) {
        const k = rowKey(r);
        if (seenKeys.has(k)) continue;
        if (edits.has(k)) continue;
        overrides.push(r);
      }

      const res = await fetch("/api/settings/openai-pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Save failed");
      } else {
        setMessage(`Saved ${overrides.length} override row${overrides.length === 1 ? "" : "s"}.`);
        setEdits(new Map());
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingOverrides(false);
    }
  }

  const hasEdits = edits.size > 0;
  const status = data?.effective.status ?? "empty";
  const upstreamError = data?.upstream && "error" in data.upstream ? data.upstream.error : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing Reference</CardTitle>
        <CardDescription>
          Paste the output of the <strong>Copy Page</strong> button on{" "}
          <code className="rounded bg-muted px-1 py-0.5">developers.openai.com/api/docs/pricing</code> to refresh the
          per-model rate sheet. Override individual rows below to match what your contract actually pays. Used for the
          parallel list-rate cost series shown alongside OpenAI&apos;s billed cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="text-sm">
            <div>
              <span className="text-muted-foreground">Last parsed: </span>
              <span className="font-medium">{formatTimestamp(data?.parsedAt)}</span>
              {status === "parse_error" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                  <AlertTriangle className="h-3 w-3" /> parse error
                </span>
              )}
              {status === "empty" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  no source yet
                </span>
              )}
              {status === "ok" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                  <ClipboardCheck className="h-3 w-3" /> ok
                </span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Last verified: </span>
              <span className="font-medium">{formatTimestamp(data?.verifiedAt)}</span>
            </div>
            {upstreamError && (
              <div className="text-xs text-amber-700 dark:text-amber-400">Last error: {upstreamError}</div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPasteOpen((v) => !v)}
          >
            {pasteOpen ? "Hide paste box" : "Paste new source"}
          </Button>
        </div>

        {pasteOpen && (
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <div className="text-sm">
              <strong>Update from source:</strong> open the OpenAI pricing page, click the{" "}
              <em>Copy Page</em> button, paste the entire output here, then click <em>Parse &amp; save</em>. The
              parser keeps existing overrides intact.
            </div>
            <Textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={14}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="Paste the Copy Page output here..."
            />
            <div className="flex items-center justify-between gap-3">
              <Button type="button" onClick={parseAndSave} disabled={parsing || sourceText.trim().length === 0}>
                {parsing ? "Parsing..." : "Parse & save"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {sourceText.length.toLocaleString()} characters
              </span>
            </div>
          </div>
        )}

        <div className="rounded-lg border bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Notes &amp; caveats:</strong> regional pricing may include a 10% uplift; batch/flex/priority tiers
          are billed differently from standard; image, audio, video, tools, and storage rows use units other than
          $/1M tokens and are reference-only — they are <em>not</em> included in the parallel list-rate cost
          calculation. The list-rate figure is an estimate intended to highlight drift versus OpenAI&apos;s billed
          cost.
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading pricing...</div>
        ) : (data?.effective.rows.length ?? 0) === 0 ? (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            No pricing rows yet. Open the paste box above and load a source to get started.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {CATEGORY_FILTERS.map((c) => {
                const count = c.key === "all" ? data?.effective.rows.length ?? 0 : counts.get(c.key) ?? 0;
                if (c.key !== "all" && count === 0) return null;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setFilter(c.key)}
                    className={
                      "rounded-full border px-2.5 py-0.5 transition " +
                      (filter === c.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-transparent hover:bg-muted")
                    }
                  >
                    {c.label} <span className="opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Model</th>
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-left font-medium">Tier</th>
                    <th className="px-3 py-2 text-left font-medium">Context</th>
                    <th className="px-3 py-2 text-right font-medium">Input / 1M</th>
                    <th className="px-3 py-2 text-right font-medium">Cached / 1M</th>
                    <th className="px-3 py-2 text-right font-medium">Output / 1M</th>
                    <th className="px-3 py-2 text-left font-medium">Unit / Notes</th>
                    <th className="px-3 py-2 text-right font-medium">Reset</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveRows.map((row) => {
                    const k = rowKey(row);
                    const tokenRow = isTokenRow(row);
                    return (
                      <tr key={k} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.model}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{row.category}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{row.tier}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{row.context}</td>
                        {tokenRow ? (
                          (["inputUsdPerMtok", "cachedInputUsdPerMtok", "outputUsdPerMtok"] as EditableField[]).map(
                            (field) => {
                              const v = getDisplayValue(row, field);
                              const overridden = isOverriddenField(row, field);
                              return (
                                <td
                                  key={field}
                                  className={
                                    "whitespace-nowrap px-3 py-2 text-right text-xs " +
                                    (overridden ? "text-primary font-semibold" : "")
                                  }
                                  title={
                                    upstreamMap.get(k)?.[field] !== undefined
                                      ? `Upstream: ${formatRate(upstreamMap.get(k)?.[field])}`
                                      : undefined
                                  }
                                >
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="h-7 w-24 px-1 text-right text-xs"
                                    value={v ?? ""}
                                    onChange={(e) => setEdit(row, field, e.target.value)}
                                  />
                                </td>
                              );
                            },
                          )
                        ) : (
                          <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground italic">
                            reference-only — see Unit / Notes
                          </td>
                        )}
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {tokenRow ? (
                            <span>{row.unit ?? "1M_tokens"}</span>
                          ) : (
                            <span>
                              <span className="font-medium text-foreground">{row.unit ?? "other"}</span>
                              {row.notes ? (
                                <span className="ml-1 block max-w-md whitespace-normal">{row.notes}</span>
                              ) : null}
                            </span>
                          )}
                          {tokenRow && row.notes ? (
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                              {row.notes}
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {tokenRow && (overrideMap.get(k) || edits.has(k)) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => resetRow(row)}
                              title="Reset row to upstream value"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button type="button" onClick={saveOverrides} disabled={savingOverrides || !hasEdits}>
            {savingOverrides ? "Saving..." : "Save overrides"}
          </Button>
          <div className="text-sm">
            {message && <span className="text-muted-foreground">{message}</span>}
            {error && <span className="text-destructive">{error}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
