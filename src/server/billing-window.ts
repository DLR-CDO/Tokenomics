/**
 * Compute the [start, end] window for a contract whose billing day-of-month
 * is `resetDay` (1-31). Inclusive of `start`, end is the last second of the
 * day before the next reset. Aligned to UTC to match storage.
 */
export function getBillingWindow(resetDay: number, now: Date): { start: Date; end: Date } {
  const year = now.getFullYear();
  const month = now.getMonth();

  let start: Date;
  let end: Date;

  if (now.getDate() >= resetDay) {
    start = new Date(Date.UTC(year, month, resetDay));
    end = new Date(Date.UTC(year, month + 1, resetDay - 1, 23, 59, 59, 999));
  } else {
    start = new Date(Date.UTC(year, month - 1, resetDay));
    end = new Date(Date.UTC(year, month, resetDay - 1, 23, 59, 59, 999));
  }

  return { start, end };
}

/**
 * Same as `getBillingWindow` but shifted by `offset` whole cycles relative
 * to the cycle that contains `now`. `offset = 0` is the current cycle,
 * `-1` the previous one, `+1` the next. The returned range is inclusive
 * of `start` and ends on the day before the following reset.
 */
export function getBillingWindowAtOffset(
  resetDay: number,
  now: Date,
  offset: number,
): { start: Date; end: Date } {
  const current = getBillingWindow(resetDay, now);
  if (offset === 0) return current;
  const startYear = current.start.getUTCFullYear();
  const startMonth = current.start.getUTCMonth();
  const start = new Date(Date.UTC(startYear, startMonth + offset, resetDay));
  const end = new Date(Date.UTC(startYear, startMonth + offset + 1, resetDay - 1, 23, 59, 59, 999));
  return { start, end };
}
