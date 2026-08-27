"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Deleting a quote for good, offered only against an archived one.
 *
 * Archiving is the undo-able step and is the only one on the quote itself;
 * this sits beside the archived quote in the list, so getting rid of a quote
 * takes going and looking for it. The name is typed back, the same as a
 * production's, because the lines and figures go with it.
 */
export function DeleteQuoteDialog({
  quoteId,
  quoteName,
  onDeleted,
}: {
  quoteId: Id<"quotes">;
  quoteName: string;
  onDeleted?: () => void;
}) {
  const remove = useMutation(api.quotes.remove);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  // One short word, not the quote number: enough of a pause to stop a stray
  // click, without making the user copy a reference back to itself.
  const confirmed = typed.trim().toLowerCase() === "delete";

  async function handleDelete() {
    setDeleting(true);
    try {
      await remove({ id: quoteId });
      toast.success(`${quoteName} deleted.`);
      setOpen(false);
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete it.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Delete
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => (!o ? setOpen(false) : undefined)}>
          <DialogContent onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Delete {quoteName}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                This removes the quote and every line and figure on it. It cannot be undone,
                and a quote is the record of what was offered — leave it archived if there is
                any doubt.
              </p>
              <div className="space-y-2">
                <Label htmlFor="confirm-delete-quote">
                  Type <span className="font-medium text-foreground">delete</span> to confirm
                </Label>
                <Input
                  id="confirm-delete-quote"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="delete"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && confirmed) {
                      e.preventDefault();
                      void handleDelete();
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!confirmed || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
