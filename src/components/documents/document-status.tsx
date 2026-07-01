"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type DocumentStatus = "draft" | "sent" | "signed" | "declined" | "voided";

const STATUS_META: Record<DocumentStatus, { label: string; className: string }> = {
  draft: {
    label: "Draft",
    className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400",
  },
  sent: {
    label: "Sent",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  },
  signed: {
    label: "Signed",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  declined: {
    label: "Declined",
    className: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
  voided: {
    label: "Voided",
    className: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
  },
};

const FALLBACK_STATUS_META = {
  label: "Unknown",
  className: "bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500",
};

/** Status pill shared by the documents list and the composer header. */
export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as DocumentStatus] ?? FALLBACK_STATUS_META;
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

/** "Send for signing" with a confirm step. Used from the list row and from the composer. */
export function SendReleaseButton({
  id,
  label = "Send",
  variant = "secondary",
}: {
  id: Id<"documents">;
  label?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
}) {
  const send = useMutation(api.documents.send);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant={variant}>
            {label}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send for signing?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This emails a signing link to the talent and locks the release from further edits until
          it&apos;s signed or declined.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await send({ id });
                toast.success("Release sent for signing.");
                setOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not send the release.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : "Send for signing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
