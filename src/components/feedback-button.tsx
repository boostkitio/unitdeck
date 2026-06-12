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

export function FeedbackButton() {
  const pathname = usePathname();
  const submit = useMutation(api.feedback.submit);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
        onClick={() => setOpen(true)}
      >
        Share feedback
      </button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share feedback</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-neutral-500">
              Spotted something clunky, broken or missing? It goes straight to the person building
              this, with the page you were on attached.
            </p>
            <Textarea
              rows={5}
              placeholder="What would make this better?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || message.trim().length < 5}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await submit({ message, page: pathname });
                    toast.success("Thanks, feedback sent.");
                    setMessage("");
                    setOpen(false);
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
