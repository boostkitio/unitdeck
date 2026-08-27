/** The words the quote uses, in one place so the builder and the client copy agree. */

export const QUOTE_CATEGORIES = [
  { value: "pre", label: "Pre Production" },
  { value: "production", label: "Production" },
  { value: "art", label: "Art Department / Location" },
  { value: "equipment", label: "Equipment" },
  { value: "travel", label: "Travel and Accommodation" },
  { value: "post", label: "Post Production" },
] as const;

export type QuoteCategory = (typeof QUOTE_CATEGORIES)[number]["value"];

export function categoryLabel(value: string): string {
  return QUOTE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const QUOTE_UNITS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "hour", label: "Hour" },
  { value: "room", label: "Room" },
  { value: "mile", label: "Mile" },
  { value: "track", label: "Track" },
  { value: "trip", label: "Trip" },
  { value: "minute", label: "Minute" },
  { value: "item", label: "Item" },
  { value: "generic", label: "Flat fee" },
] as const;

export function unitLabel(value: string): string {
  return QUOTE_UNITS.find((u) => u.value === value)?.label ?? value;
}

export const QUOTE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
] as const;

export function statusLabel(value: string): string {
  return QUOTE_STATUSES.find((s) => s.value === value)?.label ?? value;
}
