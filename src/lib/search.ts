/**
 * True when every whitespace-separated term appears somewhere in the row's
 * fields. Matching all terms rather than the raw string lets "sam sound" find
 * a sound recordist called Sam regardless of which column holds what.
 */
export function matchesSearch(search: string, fields: (string | null | undefined)[]): boolean {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
