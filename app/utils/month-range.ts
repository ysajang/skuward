/**
 * Returns the UTC month boundaries containing `now`:
 *   start = first day of the month at 00:00:00.000 UTC (inclusive)
 *   end   = first day of the NEXT month at 00:00:00.000 UTC (exclusive)
 *
 * Used to count "purchase orders created this month" for plan quotas. Query as
 * `createdAt >= start AND createdAt < end`. UTC is used for a stable, shop-
 * independent boundary (Shopify stores timestamps in UTC).
 */
export function monthRange(now: Date = new Date()): { start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return { start, end };
}
