const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "2026-08-24" → "24 Aug 2026".
 *
 * Shoot dates are stored as plain calendar days, so they are parsed as parts
 * and never through `new Date(iso)` — that would treat them as UTC midnight and
 * render the previous day for anyone west of Greenwich.
 */
export function formatShootDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Collapses a project's shoot days into one line: a single date, or the span
 * from first to last with the day count. Returns null when there are none.
 */
export function formatShootDateRange(dates: string[]): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return formatShootDate(first);
  return `${formatShootDate(first)} – ${formatShootDate(last)} · ${sorted.length} days`;
}
