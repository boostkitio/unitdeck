/**
 * Project booking status.
 *
 * Shared by the Convex functions and the UI — Convex cannot import from
 * `src/`, so the canonical list lives here and `src/lib/project-status.ts`
 * re-exports it.
 */
export const PROJECT_STATUSES = [
  { value: "not_booked", label: "Not booked" },
  { value: "pencilled", label: "Pencilled" },
  { value: "confirmed", label: "Confirmed" },
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];

/**
 * Statuses this app used before the three-state booking model, kept valid in
 * the schema so existing production documents still pass validation.
 *
 * Reads normalise them, so the UI shows the new statuses immediately without
 * waiting on a data migration. `projects.migrateStatuses` rewrites them for
 * real, after which these can be dropped from the schema union.
 */
export const LEGACY_STATUS_MAP: Record<string, ProjectStatus> = {
  brief: "not_booked",
  pre_production: "pencilled",
  shooting: "confirmed",
  post: "confirmed",
  delivered: "confirmed",
  // Archiving is a separate flag now; the status underneath is unknowable
  // after the fact, and an archived project has almost always been shot.
  archived: "confirmed",
};

export const LEGACY_STATUSES = Object.keys(LEGACY_STATUS_MAP);

/** A stored status mapped onto the current three. Unknown values fall back. */
export function normaliseStatus(value: string): ProjectStatus {
  if (PROJECT_STATUSES.some((s) => s.value === value)) return value as ProjectStatus;
  return LEGACY_STATUS_MAP[value] ?? "not_booked";
}

/** Statuses the dashboard treats as still needing work chased. */
export const NEEDS_ATTENTION_STATUSES: ProjectStatus[] = ["not_booked", "pencilled"];

export function needsAttention(status: string): boolean {
  return NEEDS_ATTENTION_STATUSES.includes(normaliseStatus(status));
}
