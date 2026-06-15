"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { CheckIssue } from "../../../convex/lib/agentProposals";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const SEVERITY_STYLES: Record<CheckIssue["severity"], string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

export function CheckDialog({
  dayId,
  onClose,
}: {
  dayId: Id<"shootDays">;
  onClose: () => void;
}) {
  const check = useAction(api.agents.callSheetChecker.run);
  const [issues, setIssues] = useState<CheckIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    check({ shootDayId: dayId })
      .then((r) => {
        if (!cancelled) setIssues(r.issues);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Check failed.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Call sheet check</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : issues === null ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reviewing the sheet like a production manager would…
            </p>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing flagged. The sheet covers the essentials. Worth a final human read before
            sending.
          </p>
        ) : (
          <ul className="max-h-96 space-y-3 overflow-y-auto">
            {issues.map((issue, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`mt-0.5 inline-flex h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[issue.severity]}`}
                >
                  {issue.severity}
                </span>
                <div>
                  <p className="text-sm">{issue.message}</p>
                  {issue.suggestion && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{issue.suggestion}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
