export {
  ARCHIVED_OPTION,
  PROJECT_STATUSES,
  LEGACY_STATUSES,
  NEEDS_ATTENTION_STATUSES,
  needsAttention,
  normaliseStatus,
  type ProjectStatus,
} from "../../convex/lib/projectStatus";

import { PROJECT_STATUSES, normaliseStatus, type ProjectStatus } from "../../convex/lib/projectStatus";

/** Human label for a stored status, including legacy values. */
export function statusLabel(value: string): string {
  const normalised = normaliseStatus(value);
  return PROJECT_STATUSES.find((s) => s.value === normalised)?.label ?? value;
}

// Traffic lights: nothing held is red, provisional is yellow, locked in is
// green. Each pairing works on both light and dark surfaces.
const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  not_booked: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  pencilled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
};

/** Archived is a flag rather than a status, and reads as neutral. */
export const ARCHIVED_BADGE =
  "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400";

const FALLBACK_BADGE =
  "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500";

/** Badge classes for a status value, with a neutral fallback for unknown values. */
export function statusBadgeClass(value: string): string {
  return STATUS_BADGE_CLASSES[normaliseStatus(value)] ?? FALLBACK_BADGE;
}
