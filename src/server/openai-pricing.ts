import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { dashboardSettings } from "@/db/schema";

/* ---------- Types ---------- */

export type PricingTier = "standard" | "batch" | "flex" | "priority";
export type ContextLen = "short" | "long";
export type Category =
  | "flagship"
  | "realtime"
  | "image"
  | "video"
  | "transcription"
  | "specialized"
  | "finetune"
  | "embeddings"
  | "moderation"
  | "tools"
  | "storage"
  | "other";

export type PricingUnit = "1M_tokens" | "1k_calls" | "per_second" | "per_GB_day" | "per_image" | "other";

export interface PricingRow {
  model: string;
  category: Category;
  tier: PricingTier;
  context: ContextLen;
  modality?: "audio" | "text" | "image";
  inputUsdPerMtok?: number;
  cachedInputUsdPerMtok?: number;
  outputUsdPerMtok?: number;
  unit?: PricingUnit;
  notes?: string;
}

export interface UpstreamPricing {
  parsedAt: string;
  status: "ok" | "empty" | "parse_error";
  rows: PricingRow[];
  rawMdx?: string;
  error?: string;
}

export interface OverridePricing {
  verifiedAt: string;
  rows: PricingRow[];
}

export interface EffectivePricing {
  parsedAt: string | null;
  verifiedAt: string | null;
  status: "ok" | "empty" | "parse_error";
  rows: PricingRow[];
}

const UPSTREAM_KEY = "openai_pricing_upstream";
const OVERRIDES_KEY = "openai_pricing_overrides";

/* ---------- DB helpers ---------- */

async function readKey<T>(key: string): Promise<T | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dashboardSettings)
    .where(eq(dashboardSettings.key, key))
    .limit(1);
  return (row?.value as T | undefined) ?? null;
}

async function writeKey(key: string, value: Record<string, unknown>): Promise<void> {
  const db = getDb();
  await db
    .insert(dashboardSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dashboardSettings.key],
      set: { value, updatedAt: new Date() },
    });
}

interface RawUpstream {
  parsedAt?: string;
  fetchedAt?: string;
  status?: "ok" | "empty" | "parse_error" | "stale";
  rows?: PricingRow[];
  rawMdx?: string;
  error?: string;
}

function normalizeUpstream(raw: RawUpstream | null): UpstreamPricing | null {
  if (!raw) return null;
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const parsedAt = raw.parsedAt ?? raw.fetchedAt ?? new Date().toISOString();
  const status: UpstreamPricing["status"] =
    raw.status === "ok" || raw.status === "empty" || raw.status === "parse_error"
      ? raw.status
      : raw.status === "stale"
        ? "parse_error"
        : "empty";
  return {
    parsedAt,
    status,
    rows,
    rawMdx: raw.rawMdx,
    error: raw.error,
  };
}

export async function getUpstreamPricing(): Promise<UpstreamPricing | null> {
  return normalizeUpstream(await readKey<RawUpstream>(UPSTREAM_KEY));
}

export async function getOverridePricing(): Promise<OverridePricing | null> {
  return readKey<OverridePricing>(OVERRIDES_KEY);
}

export async function setOverridePricing(rows: PricingRow[]): Promise<OverridePricing> {
  const value: OverridePricing = {
    verifiedAt: new Date().toISOString(),
    rows,
  };
  await writeKey(OVERRIDES_KEY, value as unknown as Record<string, unknown>);
  return value;
}

/* ---------- Effective merge ---------- */

function rowKey(r: PricingRow): string {
  return `${r.model}::${r.tier}::${r.context}::${r.modality ?? ""}`;
}

export async function getEffectivePricing(): Promise<EffectivePricing> {
  const [upstream, overrides] = await Promise.all([getUpstreamPricing(), getOverridePricing()]);

  const upstreamRows = upstream?.rows ?? [];
  const overrideRows = overrides?.rows ?? [];

  const merged = new Map<string, PricingRow>();
  for (const r of upstreamRows) merged.set(rowKey(r), r);
  for (const r of overrideRows) {
    const k = rowKey(r);
    const base = merged.get(k);
    merged.set(k, base ? { ...base, ...r } : r);
  }

  const status: "ok" | "parse_error" | "empty" = !upstream
    ? "empty"
    : upstream.status;

  return {
    parsedAt: upstream?.parsedAt ?? null,
    verifiedAt: overrides?.verifiedAt ?? null,
    status,
    rows: Array.from(merged.values()).sort(sortRows),
  };
}

function sortRows(a: PricingRow, b: PricingRow): number {
  const catOrder: Category[] = [
    "flagship",
    "specialized",
    "realtime",
    "image",
    "video",
    "transcription",
    "embeddings",
    "moderation",
    "finetune",
    "tools",
    "storage",
    "other",
  ];
  const ca = catOrder.indexOf(a.category);
  const cb = catOrder.indexOf(b.category);
  if (ca !== cb) return ca - cb;
  const tierOrder: PricingTier[] = ["standard", "batch", "flex", "priority"];
  const ta = tierOrder.indexOf(a.tier);
  const tb = tierOrder.indexOf(b.tier);
  if (ta !== tb) return ta - tb;
  if (a.context !== b.context) return a.context === "short" ? -1 : 1;
  return a.model.localeCompare(b.model);
}

/* ---------- MDX parser ---------- */

const SECTION_HEADINGS: Array<{ pattern: RegExp; category: Category; label: string }> = [
  { pattern: /flagship\s+models?/i, category: "flagship", label: "Flagship models" },
  { pattern: /specialized\s+models?/i, category: "specialized", label: "Specialized models" },
  { pattern: /finetuning|fine[- ]?tuning/i, category: "finetune", label: "Finetuning" },
  { pattern: /realtime\s+(?:and\s+)?(?:audio\s+)?(?:generation\s+)?models?/i, category: "realtime", label: "Realtime and audio generation models" },
  { pattern: /image\s+generation\s+models?/i, category: "image", label: "Image generation models" },
  { pattern: /video\s+generation\s+models?/i, category: "video", label: "Video generation models" },
  { pattern: /transcription\s+models?/i, category: "transcription", label: "Transcription models" },
  { pattern: /^\s*tools\s*$/im, category: "tools", label: "Tools" },
];

const GROUP_LABEL_TO_CATEGORY: Record<string, Category> = {
  embedding: "embeddings",
  embeddings: "embeddings",
  moderation: "moderation",
  "deep research": "specialized",
  "computer use": "specialized",
  codex: "specialized",
  chatgpt: "specialized",
  "web search": "tools",
  containers: "storage",
  "file search": "storage",
  "agent kit": "storage",
};

/** Strip helper-call wrappers but keep their inner expression. */
function neutralizeHelpers(input: string): string {
  let out = input;
  // pricingHtml("...") and pricingHtml('...') (with possible escaped chars) → bare string literal
  out = out.replace(/pricingHtml\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/g, "$1");
  // pricingTooltipHeading(...) is reference-only header decoration; replace with empty string literal
  out = out.replace(/pricingTooltipHeading\s*\([^)]*\)/g, '""');
  // withDataSharing/withLegacy/etc. wrap an array — replace `funcName(` with `(`
  // so `withDataSharing([...])` becomes `([...])` which evaluates to the array.
  out = out.replace(/\b(?:withDataSharing|withLegacy|withRegional|withRegionalUplift)\s*\(/g, "(");
  return out;
}

/** Tiny JS-literal evaluator: numbers, strings, null/true/false, arrays, objects (bare keys allowed). */
class LiteralParser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): unknown {
    this.skip();
    const v = this.value();
    this.skip();
    return v;
  }

  private skip(): void {
    while (this.i < this.src.length) {
      const c = this.src.charCodeAt(this.i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        this.i++;
        continue;
      }
      // line comment
      if (this.src[this.i] === "/" && this.src[this.i + 1] === "/") {
        while (this.i < this.src.length && this.src[this.i] !== "\n") this.i++;
        continue;
      }
      // block comment
      if (this.src[this.i] === "/" && this.src[this.i + 1] === "*") {
        this.i += 2;
        while (
          this.i < this.src.length &&
          !(this.src[this.i] === "*" && this.src[this.i + 1] === "/")
        ) {
          this.i++;
        }
        this.i += 2;
        continue;
      }
      break;
    }
  }

  private value(): unknown {
    this.skip();
    const c = this.src[this.i];
    if (c === undefined) throw new Error("unexpected end of input");
    if (c === "[") return this.array();
    if (c === "{") return this.object();
    if (c === '"' || c === "'") return this.string();
    if (c === "(") {
      this.i++;
      const v = this.value();
      this.skip();
      if (this.src[this.i] !== ")") throw new Error(`expected ) at ${this.i}`);
      this.i++;
      return v;
    }
    if (c === "-" || c === "+" || (c >= "0" && c <= "9")) return this.number();
    return this.identifier();
  }

  private array(): unknown[] {
    this.i++; // [
    const out: unknown[] = [];
    this.skip();
    while (this.src[this.i] !== "]") {
      if (this.i >= this.src.length) throw new Error("unterminated array");
      out.push(this.value());
      this.skip();
      if (this.src[this.i] === ",") {
        this.i++;
        this.skip();
      }
    }
    this.i++; // ]
    return out;
  }

  private object(): Record<string, unknown> {
    this.i++; // {
    const out: Record<string, unknown> = {};
    this.skip();
    while (this.src[this.i] !== "}") {
      if (this.i >= this.src.length) throw new Error("unterminated object");
      this.skip();
      let key: string;
      const ch = this.src[this.i];
      if (ch === '"' || ch === "'") {
        key = this.string();
      } else {
        const start = this.i;
        while (this.i < this.src.length && /[A-Za-z0-9_$]/.test(this.src[this.i]!)) this.i++;
        key = this.src.slice(start, this.i);
        if (!key) throw new Error(`expected key at ${this.i}`);
      }
      this.skip();
      if (this.src[this.i] !== ":") throw new Error(`expected : after key '${key}' at ${this.i}`);
      this.i++;
      const v = this.value();
      out[key] = v;
      this.skip();
      if (this.src[this.i] === ",") {
        this.i++;
        this.skip();
      }
    }
    this.i++; // }
    return out;
  }

  private string(): string {
    const quote = this.src[this.i++];
    let out = "";
    while (this.i < this.src.length && this.src[this.i] !== quote) {
      const c = this.src[this.i++];
      if (c === "\\") {
        const next = this.src[this.i++];
        switch (next) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "\\": out += "\\"; break;
          case "'": out += "'"; break;
          case '"': out += '"'; break;
          case "`": out += "`"; break;
          case "u": {
            const hex = this.src.slice(this.i, this.i + 4);
            this.i += 4;
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default: out += next ?? "";
        }
      } else {
        out += c;
      }
    }
    this.i++; // closing quote
    return out;
  }

  private number(): number {
    const start = this.i;
    if (this.src[this.i] === "-" || this.src[this.i] === "+") this.i++;
    while (this.i < this.src.length && /[0-9.eE+-]/.test(this.src[this.i]!)) this.i++;
    return Number(this.src.slice(start, this.i));
  }

  private identifier(): unknown {
    const start = this.i;
    while (this.i < this.src.length && /[A-Za-z0-9_$]/.test(this.src[this.i]!)) this.i++;
    const id = this.src.slice(start, this.i);
    if (id === "null") return null;
    if (id === "true") return true;
    if (id === "false") return false;
    if (id === "undefined") return undefined;
    throw new Error(`unexpected identifier '${id}' at ${start}`);
  }
}

/** Find the matching `]` for a `[` or matching `}` for a `{` starting at `from`. */
function findMatching(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

interface ComponentInvocation {
  name: "TextTokenPricingTables" | "GroupedPricingTable" | "PricingTable";
  attrText: string;
  startIdx: number;
  endIdx: number;
}

function findComponentInvocations(src: string): ComponentInvocation[] {
  const out: ComponentInvocation[] = [];
  const pattern = /<(TextTokenPricingTables|GroupedPricingTable|PricingTable)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src)) !== null) {
    const start = m.index;
    const name = m[1] as ComponentInvocation["name"];
    const attrStart = start + m[0].length;
    let i = attrStart;
    let inString: string | null = null;
    let braceDepth = 0;
    let bracketDepth = 0;
    let attrEnd = -1;
    let endIdx = -1;
    while (i < src.length) {
      const ch = src[i];
      if (inString) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        i++;
        continue;
      }
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "/" && src[i + 1] === ">" && braceDepth === 0 && bracketDepth === 0) {
        attrEnd = i;
        endIdx = i + 2;
        break;
      } else if (ch === ">" && braceDepth === 0 && bracketDepth === 0) {
        // Self-closed via ">" without "/>" — treat as block component.
        attrEnd = i;
        endIdx = i + 1;
        break;
      }
      i++;
    }
    if (attrEnd > attrStart && endIdx > start) {
      out.push({
        name,
        attrText: src.slice(attrStart, attrEnd),
        startIdx: start,
        endIdx,
      });
      pattern.lastIndex = endIdx;
    }
  }
  return out;
}

function extractAttribute(attrText: string, name: string): string | undefined {
  // Match name="value" or name={value} (value may be JS literal). For string attrs like tier="standard".
  const strMatch = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrText);
  if (strMatch) return strMatch[1];
  const sMatch = new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(attrText);
  if (sMatch) return sMatch[1];
  // For braced: ${name}={value} — find the `{` after `name=` and walk balanced braces.
  const braceStart = new RegExp(`${name}\\s*=\\s*\\{`).exec(attrText);
  if (braceStart) {
    const startBrace = braceStart.index + braceStart[0].length - 1;
    const end = findMatching(attrText, startBrace, "{", "}");
    if (end > startBrace) return attrText.slice(startBrace + 1, end);
  }
  return undefined;
}

function activeTier(invocation: ComponentInvocation, src: string, sectionStartIdx: number): PricingTier {
  const tierAttr = extractAttribute(invocation.attrText, "tier");
  if (tierAttr && ["standard", "batch", "flex", "priority"].includes(tierAttr.toLowerCase())) {
    return tierAttr.toLowerCase() as PricingTier;
  }
  // Only honor data-value="..." panes that appear AFTER the current section's heading,
  // so a previous section's open pane doesn't leak into later flat-priced sections.
  const window = src.slice(sectionStartIdx, invocation.startIdx);
  const matches = [...window.matchAll(/data-value\s*=\s*"(standard|batch|flex|priority)"/g)];
  if (matches.length > 0) {
    return matches[matches.length - 1]![1] as PricingTier;
  }
  return "standard";
}

interface SectionState {
  category: Category;
  label: string;
  startIdx: number;
}

function activeSectionAt(idx: number, src: string): SectionState {
  const before = src.slice(0, idx);
  let best: SectionState = { category: "other", label: "", startIdx: 0 };
  let bestIdx = -1;
  for (const sec of SECTION_HEADINGS) {
    const re = new RegExp(sec.pattern.source, sec.pattern.flags.includes("g") ? sec.pattern.flags : sec.pattern.flags + "g");
    let m: RegExpExecArray | null;
    let lastIdx = -1;
    while ((m = re.exec(before)) !== null) lastIdx = m.index;
    if (lastIdx > bestIdx) {
      bestIdx = lastIdx;
      best = { category: sec.category, label: sec.label, startIdx: lastIdx };
    }
  }
  return best;
}

function activeSection(invocation: ComponentInvocation, src: string): SectionState {
  return activeSectionAt(invocation.startIdx, src);
}

interface OrphanGroup {
  startIdx: number;
  endIdx: number;
  data: { model: string; rows: unknown[] };
}

/**
 * Salvage `{ model: "...", rows: [...] }` fragments whose surrounding
 * `<PricingTable>` / `<GroupedPricingTable>` opening tag was eaten by the
 * OpenAI pricing page's "Copy Page" markdown serializer. Skips fragments
 * that fall inside an already-parsed component range so a clean future
 * paste still routes through the regular component path.
 */
function findOrphanGroups(src: string, processedRanges: Array<[number, number]>): OrphanGroup[] {
  const out: OrphanGroup[] = [];
  const claimed: Array<[number, number]> = [...processedRanges];
  const isClaimed = (idx: number) => claimed.some(([s, e]) => idx >= s && idx <= e);

  const re = /\{\s*model\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const startIdx = m.index;
    if (isClaimed(startIdx)) continue;
    const endIdx = findMatching(src, startIdx, "{", "}");
    if (endIdx === -1) continue;

    const slice = src.slice(startIdx, endIdx + 1);
    let parsed: unknown;
    try {
      parsed = new LiteralParser(slice).parse();
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const obj = parsed as { model?: unknown; rows?: unknown };
    if (typeof obj.model !== "string") continue;
    if (!Array.isArray(obj.rows)) continue;

    out.push({ startIdx, endIdx, data: { model: obj.model, rows: obj.rows } });
    claimed.push([startIdx, endIdx]);
    re.lastIndex = endIdx + 1;
  }
  return out;
}

function parseRowsAttr(attrText: string): unknown[] {
  const raw = extractAttribute(attrText, "rows");
  if (!raw) return [];
  // raw is already the inner JS expression (without the surrounding {}).
  const literal = neutralizeHelpers(raw).trim();
  if (!literal.startsWith("[")) return [];
  const parser = new LiteralParser(literal);
  const result = parser.parse();
  return Array.isArray(result) ? result : [];
}

function coerceRate(v: unknown): { rate?: number; note?: string } {
  if (v === null || v === undefined) return {};
  if (typeof v === "number") return Number.isFinite(v) ? { rate: v } : {};
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "—") return {};
    if (/^free$/i.test(trimmed)) return { note: "Free" };
    // numeric strings like "1.5"
    const n = Number(trimmed);
    if (Number.isFinite(n) && /^-?\d/.test(trimmed)) return { rate: n };
    return { note: trimmed };
  }
  return {};
}

function cleanModelName(raw: string): { model: string; note?: string } {
  // "gpt-5.5 (<272K context length)" → model "gpt-5.5", note "<272K context length"
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(raw);
  if (m) {
    return { model: m[1]!.trim(), note: m[2]!.trim() };
  }
  return { model: raw.trim() };
}

function mergeNotes(...parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((p): p is string => Boolean(p && p.trim()));
  if (filtered.length === 0) return undefined;
  return filtered.join("; ");
}

function categoryFromGroupLabel(rawLabel: string, fallback: Category): Category {
  const label = rawLabel.replace(/<[^>]*>/g, "").trim().toLowerCase();
  for (const [key, cat] of Object.entries(GROUP_LABEL_TO_CATEGORY)) {
    if (label.startsWith(key)) return cat;
  }
  return fallback;
}

function buildTextTokenRow(
  tuple: unknown[],
  tier: PricingTier,
  category: Category,
): PricingRow | null {
  if (tuple.length < 4) return null;
  const modelRaw = typeof tuple[0] === "string" ? tuple[0] : String(tuple[0] ?? "");
  if (!modelRaw) return null;
  const cleaned = cleanModelName(modelRaw);
  if (tuple.length === 5) {
    // [model, training, input, cached, output]
    const training = coerceRate(tuple[1]);
    const inp = coerceRate(tuple[2]);
    const cached = coerceRate(tuple[3]);
    const out = coerceRate(tuple[4]);
    const hasNumeric = inp.rate !== undefined || cached.rate !== undefined || out.rate !== undefined;
    const hasNote = Boolean(training.note || inp.note || cached.note || out.note || training.rate !== undefined);
    if (!hasNumeric && !hasNote) return null;
    return {
      model: cleaned.model,
      category,
      tier,
      context: "short",
      inputUsdPerMtok: inp.rate,
      cachedInputUsdPerMtok: cached.rate,
      outputUsdPerMtok: out.rate,
      unit: "1M_tokens",
      notes: mergeNotes(
        cleaned.note,
        training.note ? `Training: ${training.note}` : training.rate !== undefined ? `Training: $${training.rate}/hour` : undefined,
        inp.note ? `Input: ${inp.note}` : undefined,
        cached.note ? `Cached: ${cached.note}` : undefined,
        out.note ? `Output: ${out.note}` : undefined,
      ),
    };
  }
  // [model, input, cached, output]
  const inp = coerceRate(tuple[1]);
  const cached = coerceRate(tuple[2]);
  const out = coerceRate(tuple[3]);
  const hasNumeric = inp.rate !== undefined || cached.rate !== undefined || out.rate !== undefined;
  const hasNote = Boolean(inp.note || cached.note || out.note);
  if (!hasNumeric && !hasNote) return null;
  return {
    model: cleaned.model,
    category,
    tier,
    context: "short",
    inputUsdPerMtok: inp.rate,
    cachedInputUsdPerMtok: cached.rate,
    outputUsdPerMtok: out.rate,
    unit: "1M_tokens",
    notes: mergeNotes(
      cleaned.note,
      inp.note ? `Input: ${inp.note}` : undefined,
      cached.note ? `Cached: ${cached.note}` : undefined,
      out.note ? `Output: ${out.note}` : undefined,
    ),
  };
}

function buildPricingTableRow(
  tuple: unknown[],
  tier: PricingTier,
  category: Category,
): PricingRow | null {
  if (tuple.length < 2) return null;
  const labelRaw = typeof tuple[0] === "string" ? tuple[0] : String(tuple[0] ?? "");
  const desc = typeof tuple[1] === "string" ? tuple[1] : String(tuple[1] ?? "");
  if (!labelRaw) return null;
  // Strip HTML tags from labels for clean display while keeping the description as-is.
  const model = labelRaw.replace(/<[^>]*>/g, "").trim();
  const description = desc.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
  // Best-effort unit detection from description for downstream classification.
  let unit: PricingUnit = "other";
  if (/per\s+second/i.test(description)) unit = "per_second";
  else if (/\/\s*1k\s*calls|per\s+1k\s+calls/i.test(description)) unit = "1k_calls";
  else if (/\/\s*GB[\s-]*day|per\s+GB[\s-]*day|GB[- ]?day/i.test(description)) unit = "per_GB_day";
  else if (/per\s+image/i.test(description)) unit = "per_image";
  return {
    model,
    category,
    tier,
    context: "short",
    unit,
    notes: description || undefined,
  };
}

function emitGroupRows(
  groupLabel: string,
  groupRows: unknown[],
  tier: PricingTier,
  fallbackCategory: Category,
  out: PricingRow[],
): void {
  const groupCategory = categoryFromGroupLabel(groupLabel, fallbackCategory);
  for (const item of groupRows) {
    if (!Array.isArray(item)) continue;
    // Group rows look like [name, ...rates] or sometimes [name, description] for tools-style entries.
    const allRatesNumeric = item
      .slice(1)
      .every(
        (v) =>
          v == null ||
          typeof v === "number" ||
          (typeof v === "string" && (v === "-" || v === "" || /^free$/i.test(v) || /^-?\d/.test(v))),
      );
    if (allRatesNumeric && item.length >= 4) {
      const row = buildTextTokenRow(item, tier, groupCategory);
      if (row) out.push(row);
    } else if (item.length >= 2) {
      const row = buildPricingTableRow(item, tier, groupCategory);
      if (row) out.push(row);
    }
  }
}

export function parsePricingMdx(raw: string): PricingRow[] {
  const src = neutralizeHelpers(raw);
  const invocations = findComponentInvocations(src);
  const out: PricingRow[] = [];

  for (const inv of invocations) {
    const section = activeSection(inv, src);
    const tier = activeTier(inv, src, section.startIdx);

    let rows: unknown[];
    try {
      rows = parseRowsAttr(inv.attrText);
    } catch {
      continue;
    }

    if (inv.name === "TextTokenPricingTables") {
      // Section-determined category, with finetune special-casing handled by section heading.
      const category = section.category === "other" ? "flagship" : section.category;
      for (const item of rows) {
        if (Array.isArray(item)) {
          const row = buildTextTokenRow(item, tier, category);
          if (row) out.push(row);
        }
      }
    } else if (inv.name === "GroupedPricingTable") {
      // [{ model: <group label>, rows: [[name, in, cached, out], ...] }, ...]
      const fallback: Category = section.category === "other" ? "specialized" : section.category;
      for (const group of rows) {
        if (!group || typeof group !== "object" || Array.isArray(group)) continue;
        const g = group as { model?: unknown; rows?: unknown };
        const groupLabel = typeof g.model === "string" ? g.model : String(g.model ?? "");
        const groupRows = Array.isArray(g.rows) ? g.rows : [];
        emitGroupRows(groupLabel, groupRows, tier, fallback, out);
      }
    } else if (inv.name === "PricingTable") {
      // [{ model: <group label>, rows: [[label, description], ...] }, ...] OR flat [[label, description], ...]
      const fallback: Category = section.category === "other" ? "tools" : section.category;
      for (const item of rows) {
        if (Array.isArray(item)) {
          const row = buildPricingTableRow(item, tier, fallback);
          if (row) out.push(row);
        } else if (item && typeof item === "object") {
          const g = item as { model?: unknown; rows?: unknown };
          const groupLabel = typeof g.model === "string" ? g.model : String(g.model ?? "");
          const groupRows = Array.isArray(g.rows) ? g.rows : [];
          emitGroupRows(groupLabel, groupRows, tier, fallback, out);
        }
      }
    }
  }

  // Salvage: the OpenAI "Copy Page" output occasionally truncates the opening
  // <PricingTable rows={[ … or <GroupedPricingTable rows={[ … tag and the
  // first inner entry, but leaves later `{ model: "...", rows: [...] }`
  // fragments intact along with the closing `]} />`. Recover those.
  const processedRanges: Array<[number, number]> = invocations.map((inv) => [inv.startIdx, inv.endIdx]);
  const orphans = findOrphanGroups(src, processedRanges);
  for (const orphan of orphans) {
    const fakeInv: ComponentInvocation = {
      name: "GroupedPricingTable",
      attrText: "",
      startIdx: orphan.startIdx,
      endIdx: orphan.endIdx,
    };
    const section = activeSection(fakeInv, src);
    const tier = activeTier(fakeInv, src, section.startIdx);
    // Without the wrapping component we don't know if the source was a
    // <GroupedPricingTable> (token rates) or <PricingTable> (string rates),
    // but emitGroupRows decides per-row by inspecting numeric-ness, so
    // either case lands correctly. Section fallback chooses between
    // tools/specialized/etc.
    const fallback: Category = section.category === "other" ? "tools" : section.category;
    emitGroupRows(orphan.data.model, orphan.data.rows, tier, fallback, out);
  }

  return dedupeRows(out);
}

function dedupeRows(rows: PricingRow[]): PricingRow[] {
  const seen = new Map<string, PricingRow>();
  for (const r of rows) {
    const k = rowKey(r);
    const prev = seen.get(k);
    if (!prev) {
      seen.set(k, r);
      continue;
    }
    seen.set(k, {
      ...prev,
      ...r,
      inputUsdPerMtok: r.inputUsdPerMtok ?? prev.inputUsdPerMtok,
      cachedInputUsdPerMtok: r.cachedInputUsdPerMtok ?? prev.cachedInputUsdPerMtok,
      outputUsdPerMtok: r.outputUsdPerMtok ?? prev.outputUsdPerMtok,
      notes: prev.notes && r.notes ? mergeNotes(prev.notes, r.notes) : (r.notes ?? prev.notes),
    });
  }
  return Array.from(seen.values());
}

/* ---------- Source ingest ---------- */

export interface SetSourceResult {
  ok: boolean;
  status: "ok" | "empty" | "parse_error";
  parsedAt: string;
  rowCount: number;
  error?: string;
}

export async function setUpstreamFromMdx(rawMdx: string): Promise<SetSourceResult> {
  const parsedAt = new Date().toISOString();
  let rows: PricingRow[] = [];
  let parseErr: string | undefined;
  try {
    rows = parsePricingMdx(rawMdx);
  } catch (e) {
    parseErr = e instanceof Error ? e.message : String(e);
  }

  if (parseErr || rows.length === 0) {
    const prev = await getUpstreamPricing();
    const upstream: UpstreamPricing = {
      parsedAt,
      status: parseErr ? "parse_error" : "empty",
      rows: prev?.rows ?? [],
      rawMdx,
      error: parseErr,
    };
    await writeKey(UPSTREAM_KEY, upstream as unknown as Record<string, unknown>);
    return {
      ok: false,
      status: upstream.status,
      parsedAt,
      rowCount: upstream.rows.length,
      error: parseErr ?? "parser returned 0 rows",
    };
  }

  const upstream: UpstreamPricing = { parsedAt, status: "ok", rows, rawMdx };
  await writeKey(UPSTREAM_KEY, upstream as unknown as Record<string, unknown>);
  return { ok: true, status: "ok", parsedAt, rowCount: rows.length };
}

/* ---------- Lookup helpers used by list-rate cost calc ---------- */

export interface PricingLookup {
  rates: Map<string, PricingRow>;
  defaults: { tier: PricingTier; context: ContextLen };
}

function stripParenSuffix(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function buildPricingLookup(
  effective: EffectivePricing,
  defaults: { tier: PricingTier; context: ContextLen } = { tier: "standard", context: "short" },
): PricingLookup {
  const rates = new Map<string, PricingRow>();
  const eligible = effective.rows.filter(
    (r) => r.unit === "1M_tokens" && r.tier === defaults.tier && r.context === defaults.context,
  );
  // Fall back to any tier/context if the default combination is empty.
  const pool = eligible.length > 0 ? eligible : effective.rows.filter((r) => r.unit === "1M_tokens");
  for (const r of pool) {
    if (!rates.has(r.model)) rates.set(r.model, r);
    const lc = r.model.toLowerCase();
    if (!rates.has(lc)) rates.set(lc, r);
    const stripped = stripParenSuffix(r.model);
    if (stripped && !rates.has(stripped)) rates.set(stripped, r);
    const strippedLc = stripped.toLowerCase();
    if (strippedLc && !rates.has(strippedLc)) rates.set(strippedLc, r);
  }
  return { rates, defaults };
}

export function getRateForModel(lookup: PricingLookup, modelName: string | null | undefined): PricingRow | null {
  if (!modelName) return null;
  const candidates = [
    modelName,
    modelName.toLowerCase(),
    stripParenSuffix(modelName),
    stripParenSuffix(modelName).toLowerCase(),
  ];
  for (const c of candidates) {
    const direct = lookup.rates.get(c);
    if (direct) return direct;
  }
  // Prefix fallback for models like "gpt-4o-2024-05-13" where pasted rates use just "gpt-4o-2024-05-13" already.
  const lc = modelName.toLowerCase();
  for (const [k, v] of lookup.rates.entries()) {
    if (lc.startsWith(k) && k.length >= 3) return v;
  }
  return null;
}

export function computeListRateUsd(
  rate: PricingRow | null,
  tokensIn: number,
  tokensOut: number,
  cachedTokens: number,
): number {
  if (!rate || rate.unit !== "1M_tokens") return 0;
  const uncachedIn = Math.max(0, tokensIn - cachedTokens);
  const inUsd = ((rate.inputUsdPerMtok ?? 0) * uncachedIn) / 1_000_000;
  const cachedUsd = ((rate.cachedInputUsdPerMtok ?? 0) * cachedTokens) / 1_000_000;
  const outUsd = ((rate.outputUsdPerMtok ?? 0) * tokensOut) / 1_000_000;
  return inUsd + cachedUsd + outUsd;
}
