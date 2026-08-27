"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { FeedbackItem, FeedbackReply } from "../../../../convex/feedback";
import { getFeedbackType } from "@/lib/feedback-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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

/**
 * A box for rewriting something you already said, or for writing a reply.
 *
 * Shared by both because they are the same control with a different verb, and
 * a reply that behaved differently from an edit would be one thing too many to
 * learn on a page nobody visits twice a day.
 */
function MessageBox({
  initial,
  action,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  action: string;
  placeholder?: string;
  onSubmit: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (draft.trim().length === 0) return;
    setSaving(true);
    try {
      await onSubmit(draft.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        rows={2}
        autoFocus
        onKeyDown={(e) => {
          // Enter sends, as it does everywhere else a short message is typed;
          // Shift+Enter is the newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={saving || draft.trim().length === 0}>
          {saving ? "Saving…" : action}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FeedbackRow({
  item,
  onToggle,
}: {
  item: FeedbackItem;
  onToggle: (id: FeedbackItem["_id"], next: "open" | "addressed") => void;
}) {
  const editFeedback = useMutation(api.feedback.edit);
  const reply = useMutation(api.feedback.reply);
  const editReply = useMutation(api.feedback.editReply);
  // One thing open at a time: the comment being edited, the reply being
  // edited, or the new reply. Anything else and the row becomes a form.
  const [open, setOpen] = useState<
    { kind: "edit" } | { kind: "reply" } | { kind: "editReply"; id: FeedbackReply["_id"] } | null
  >(null);

  const isAddressed = item.status === "addressed";

  async function run(work: Promise<unknown>, failure: string) {
    try {
      await work;
      setOpen(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
    }
  }

  return (
    <div className="py-3 first:pt-0">
      <div className="flex items-start gap-3">
        <TypeChip type={item.type} />
        <div className="min-w-0 flex-1 space-y-1">
          {open?.kind === "edit" ? (
            <MessageBox
              initial={item.message}
              action="Save"
              onCancel={() => setOpen(null)}
              onSubmit={(message) =>
                run(editFeedback({ id: item._id, message }), "Could not save it.")
              }
            />
          ) : (
            <p className={cn("text-sm", isAddressed && "text-muted-foreground line-through")}>
              {item.message}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {item.who} &middot; {formatDate(item._creationTime)}
            {item.edited && " · edited"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.mine && open === null && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setOpen({ kind: "edit" })}
            >
              Edit
            </Button>
          )}
          {open === null && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setOpen({ kind: "reply" })}
            >
              Reply
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => onToggle(item._id, isAddressed ? "open" : "addressed")}
          >
            {isAddressed ? "Reopen" : "Mark addressed"}
          </Button>
        </div>
      </div>

      {(item.replies.length > 0 || open?.kind === "reply") && (
        <div className="mt-3 space-y-3 border-l-2 border-border pl-4 sm:ml-[4.5rem]">
          {item.replies.map((r) => (
            <div key={r._id} className="space-y-1">
              {open?.kind === "editReply" && open.id === r._id ? (
                <MessageBox
                  initial={r.message}
                  action="Save"
                  onCancel={() => setOpen(null)}
                  onSubmit={(message) =>
                    run(editReply({ id: r._id, message }), "Could not save it.")
                  }
                />
              ) : (
                <>
                  <p className="text-sm">{r.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.who} &middot; {formatDate(r._creationTime)}
                    {r.edited && " · edited"}
                    {r.mine && open === null && (
                      <button
                        type="button"
                        onClick={() => setOpen({ kind: "editReply", id: r._id })}
                        className="ml-2 underline underline-offset-2 hover:text-foreground"
                      >
                        Edit
                      </button>
                    )}
                  </p>
                </>
              )}
            </div>
          ))}

          {open?.kind === "reply" && (
            <MessageBox
              action="Reply"
              placeholder="Reply to this…"
              onCancel={() => setOpen(null)}
              onSubmit={(message) =>
                run(reply({ feedbackId: item._id, message }), "Could not post the reply.")
              }
            />
          )}
        </div>
      )}
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
