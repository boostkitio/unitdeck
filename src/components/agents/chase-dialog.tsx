"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function ChaseDialog({
  dayId,
  onClose,
}: {
  dayId: Id<"shootDays">;
  onClose: () => void;
}) {
  const draftChase = useAction(api.agents.messageDrafter.draft);
  const approveAndSend = useMutation(api.agents.messageDrafter.approveAndSend);
  const reject = useMutation(api.agents.messageDrafter.reject);

  const [runId, setRunId] = useState<Id<"agentRuns"> | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    draftChase({ shootDayId: dayId })
      .then((r) => {
        if (cancelled) return;
        setRunId(r.runId);
        setSubject(r.proposal.subject);
        setBody(r.proposal.body);
        setCount(r.unconfirmedCount);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Drafting failed.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId]);

  async function discard() {
    if (runId) {
      try {
        await reject({ runId });
      } catch {
        // already decided; nothing to do
      }
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void discard()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chase unconfirmed crew</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : runId === null ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">Drafting a nudge…</p>
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Goes to the {count} unconfirmed {count === 1 ? "person" : "people"}, each with their
              personal call sheet link appended. Edit freely before sending.
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="chase-subject">Subject</Label>
                <Input
                  id="chase-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chase-body">Message</Label>
                <Textarea
                  id="chase-body"
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
                Discard
              </Button>
              <Button
                disabled={busy || subject.trim() === "" || body.trim() === ""}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const queued = await approveAndSend({ runId, subject, body });
                    toast.success(
                      `Chase sent to ${queued} ${queued === 1 ? "person" : "people"}.`
                    );
                    onClose();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Send failed.");
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Sending…" : `Send to ${count}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
