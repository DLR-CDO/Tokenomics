const DAY_MS = 24 * 60 * 60 * 1000;

/** Oldest timestamp to request for daily usage + filtered usage events (chunked on the wire). */
export function getCursorSyncLookbackStartMs(): number {
  const raw = process.env.CURSOR_SYNC_LOOKBACK_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const days = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 3650) : 730;
  return Date.now() - days * DAY_MS;
}

/** Preferred analytics relative windows (largest first). Cursor may reject some; we fall back. */
export const CURSOR_ANALYTICS_RANGE_ATTEMPTS = ["365d", "180d", "90d", "30d"] as const;

export type CursorAnalyticsRange = (typeof CURSOR_ANALYTICS_RANGE_ATTEMPTS)[number];

export function getCursorAnalyticsRangeOverride(): CursorAnalyticsRange | null {
  const v = process.env.CURSOR_ANALYTICS_LOOKBACK?.trim();
  if (!v) return null;
  if (CURSOR_ANALYTICS_RANGE_ATTEMPTS.includes(v as CursorAnalyticsRange)) {
    return v as CursorAnalyticsRange;
  }
  return null;
}
