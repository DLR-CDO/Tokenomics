const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the Unix-ms timestamp for the start of the OpenAI lookback window.
 * Reads OPENAI_SYNC_LOOKBACK_DAYS (default 90, max 180 — the API hard limit for daily buckets).
 */
export function getOpenAISyncLookbackStartMs(): number {
  const raw = process.env.OPENAI_SYNC_LOOKBACK_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const days = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 180) : 90;
  return Date.now() - days * DAY_MS;
}
