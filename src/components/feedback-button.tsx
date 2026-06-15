"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FEEDBACK_TYPES, type FeedbackType } from "@/lib/feedback-types";
import { cn } from "@/lib/utils";

export function FeedbackButton() {
  const pathname = usePathname();
  const submit = useMutation(api.feedback.submit);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<FeedbackType>("missing");
  const [busy, setBusy] = useState(false);

  function handleClose() {
    setOpen(false);
    setMessage("");
    setType("missing");
  }

  return (
    <>
      <button
        className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => setOpen(true)}
      >
        Share feedback
      </button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && handleClose()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share feedback</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Spotted something clunky, broken or missing? It goes straight to the person building
              this, with the page you were on attached.
            </p>

            {/* Type picker */}
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  type="button"
                  onClick={() => setType(ft.value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-opacity",
                    ft.className,
                    type === ft.value
                      ? "ring-current opacity-100"
                      : "ring-transparent opacity-50 hover:opacity-75"
                  )}
                >
                  {ft.label}
                </button>
              ))}
            </div>

            <Textarea
              rows={5}
              placeholder="What would make this better?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                disabled={busy || message.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await submit({ message, page: pathname, type });
                    toast.success("Thanks, feedback sent.");
                    handleClose();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not send feedback.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Sending…" : "Send feedback"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
