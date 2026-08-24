export {
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

// Canonical status colours. Each works on both light and dark surfaces.
// not booked = slate (nothing held), pencilled = amber (provisional),
// confirmed = emerald (locked in).
const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  not_booked: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  pencilled: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
};

const FALLBACK_BADGE =
  "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500";

/** Badge classes for a status value, with a neutral fallback for unknown values. */
export function statusBadgeClass(value: string): string {
  return STATUS_BADGE_CLASSES[normaliseStatus(value)] ?? FALLBACK_BADGE;
}
