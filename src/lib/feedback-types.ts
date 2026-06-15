export type FeedbackType = "missing" | "issue" | "idea" | "praise";

export type FeedbackTypeConfig = {
  value: FeedbackType;
  label: string;
  className: string;
};

export const FEEDBACK_TYPES: FeedbackTypeConfig[] = [
  {
    value: "missing",
    label: "Missing",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    value: "issue",
    label: "Issue",
    className:
      "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
  {
    value: "idea",
    label: "Idea",
    className:
      "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  },
  {
    value: "praise",
    label: "Looks good",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
];

/** Quick lookup by value — label and className for a given FeedbackType. */
export function getFeedbackType(value: FeedbackType | undefined): FeedbackTypeConfig {
  return (
    FEEDBACK_TYPES.find((t) => t.value === value) ?? FEEDBACK_TYPES[0]
  );
}
