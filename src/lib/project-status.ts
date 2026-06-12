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

export const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  brief: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  pre_production: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  shooting: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  post: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  archived: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};
