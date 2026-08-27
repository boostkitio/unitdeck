/**
 * Money in the browser.
 *
 * Everything is pence, as it is on the backend; these are for reading and
 * typing, which are the only two places a decimal point belongs.
 */

export { formatPence } from "../../convex/lib/quoteMath";

/** "1234.56" or "£1,234.56" or " 1234 " to 123456 pence. Null if it is not a number. */
export function parsePounds(input: string): number | null {
  const cleaned = input.trim().replace(/[£,\s]/g, "");
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Pence to what goes in an input box: "1234.56", no symbol, no separators. */
export function poundsInput(pence: number): string {
  return (pence / 100).toFixed(2);
}

/** Basis points to what goes in an input box: 1000 to "10". */
export function bpInput(bp: number): string {
  return String(bp / 100);
}

/** "10" or "10.5" to basis points. Null if it is not a number. */
export function parsePercent(input: string): number | null {
  const cleaned = input.trim().replace(/[%\s]/g, "");
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
