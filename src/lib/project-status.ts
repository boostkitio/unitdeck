export const PROJECT_STATUSES = [
  { value: "brief", label: "Brief" },
  { value: "pre_production", label: "Pre-production" },
  { value: "shooting", label: "Shooting" },
  { value: "post", label: "Post" },
  { value: "delivered", label: "Delivered" },
  { value: "archived", label: "Archived" },
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];

export function statusLabel(value: string): string {
  return PROJECT_STATUSES.find((s) => s.value === value)?.label ?? value;
}

// Canonical status colours. Each works on both light and dark surfaces.
// brief=slate, pre-pro=amber, shooting=emerald (rolling), post=violet, delivered=blue, archived=muted.
const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  brief: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  pre_production: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  shooting: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  post: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  delivered: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  archived: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};

const FALLBACK_BADGE =
  "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500";

/** Badge classes for a status value, with a neutral fallback for unknown values. */
export function statusBadgeClass(value: string): string {
  return STATUS_BADGE_CLASSES[value as ProjectStatus] ?? FALLBACK_BADGE;
}
