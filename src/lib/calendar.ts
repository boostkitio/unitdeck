// Monday-first, matching UK production week conventions.
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A calendar month. `month` is 0-indexed, matching the Date constructor. */
export type Month = { year: number; month: number };

/** "YYYY-MM-DD" from local calendar parts, avoiding any UTC shift. */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth({ year, month }: Month): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/** Blank cells before the 1st, with Monday as column 0. */
export function leadingBlanks({ year, month }: Month): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

export function addMonths({ year, month }: Month, delta: number): Month {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

/** The month a "YYYY-MM-DD" falls in. */
export function monthOf(key: string): Month {
  const [year, month] = key.split("-").map(Number);
  return { year, month: month - 1 };
}

/** Today as a local "YYYY-MM-DD". Client-only — see MonthCalendar. */
export function todayKey(): string {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Number of days from `from` to `to` inclusive. Walked in UTC so the count
 * never shifts with the viewer's timezone or a daylight-saving boundary.
 */
export function dayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}
