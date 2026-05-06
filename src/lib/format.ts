export function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
    value,
  );
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatChartDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export interface FormatCreditsOptions {
  /** When true, render 0 as the em-dash placeholder "—". */
  emptyDash?: boolean;
  /** Suffix appended after the compact number. Default " cr". Pass "" to omit. */
  suffix?: string;
}

/**
 * Compact credit formatting: 1.2M cr / 5.4K cr / 12.3 cr.
 * Centralizes a pattern that was duplicated across enterprise dashboard clients.
 */
export function formatCredits(value: number, options: FormatCreditsOptions = {}): string {
  const { emptyDash = false, suffix = " cr" } = options;
  if (emptyDash && value === 0) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M${suffix}`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K${suffix}`;
  return `${value.toFixed(1)}${suffix}`;
}
