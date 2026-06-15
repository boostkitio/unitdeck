"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { FeedbackItem } from "../../../../convex/feedback";
import { getFeedbackType } from "@/lib/feedback-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByPage(items: FeedbackItem[]): Map<string, FeedbackItem[]> {
  const map = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const bucket = map.get(item.page) ?? [];
    bucket.push(item);
    map.set(item.page, bucket);
  }
  return map;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypeChip({ type }: { type: FeedbackItem["type"] }) {
  const config = getFeedbackType(type);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}

function FeedbackRow({
  item,
  onToggle,
}: {
  item: FeedbackItem;
  onToggle: (id: FeedbackItem["_id"], next: "open" | "addressed") => void;
}) {
  const isAddressed = item.status === "addressed";
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0">
      <TypeChip type={item.type} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("text-sm", isAddressed && "text-muted-foreground line-through")}>
          {item.message}
        </p>
        <p className="text-xs text-muted-foreground">
          {item.who} &middot; {formatDate(item._creationTime)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs"
        onClick={() => onToggle(item._id, isAddressed ? "open" : "addressed")}
      >
        {isAddressed ? "Reopen" : "Mark addressed"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type FilterMode = "open" | "all";

export default function FeedbackPage() {
  const { organization } = useOrganization();
  const items = useQuery(api.feedback.list, organization ? {} : "skip");
  const setStatus = useMutation(api.feedback.setStatus);
  const [filter, setFilter] = useState<FilterMode>("open");

  async function handleToggle(id: FeedbackItem["_id"], next: "open" | "addressed") {
    try {
      await setStatus({ id, status: next });
    } catch {
      // silent — the optimistic update reverts automatically
    }
  }

  const filtered =
    items === undefined
      ? undefined
      : filter === "open"
        ? items.filter((i) => i.status === "open")
        : items;

  const grouped = filtered ? groupByPage(filtered) : undefined;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Feedback</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What needs attention on each page.
          </p>
        </div>

        {/* Filter toggle */}
        <div className="flex shrink-0 rounded-lg border border-border bg-muted p-0.5">
          {(["open", "all"] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                filter === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mt-6 space-y-4">
        {items === undefined ? (
          // Loading skeletons
          <>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : grouped && grouped.size === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {filter === "open" ? "No open feedback." : "No feedback yet."}
          </p>
        ) : (
          grouped &&
          Array.from(grouped.entries()).map(([page, pageItems]) => (
            <Card key={page}>
              <CardHeader>
                <CardTitle className="font-mono text-sm text-muted-foreground">{page}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {pageItems.map((item) => (
                    <FeedbackRow key={item._id} item={item} onToggle={handleToggle} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
