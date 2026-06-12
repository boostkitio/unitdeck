"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { CallSheetData } from "../../../convex/lib/callSheetData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChaseDialog } from "@/components/agents/chase-dialog";

export function SendDialog({
  dayId,
  data,
  onClose,
}: {
  dayId: Id<"shootDays">;
  data: CallSheetData;
  onClose: () => void;
}) {
  const send = useMutation(api.distribution.send);
  const sendable = data.crew.filter((c) => c.email && c.email.includes("@"));
  const missingEmail = data.crew.filter((c) => !c.email || !c.email.includes("@"));
  const [selected, setSelected] = useState<Set<string>>(new Set(sendable.map((c) => c.id)));
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send call sheet</DialogTitle>
        </DialogHeader>
        {sendable.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No crew members have an email address yet. Add emails to crew rows first (pick people
            from your People database to fill them automatically).
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-neutral-500">
              Sending freezes this version and emails each person a personal link. They confirm on
              the page, no login needed.
            </p>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              {sendable.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setSelected(next);
                    }}
                  />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-neutral-500">
                    {c.role} · {c.email} · call {c.callTime}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {missingEmail.length > 0 && (
          <p className="text-xs text-amber-600">
            No email, can&apos;t send: {missingEmail.map((c) => c.name || "(unnamed)").join(", ")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || selected.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await send({
                  shootDayId: dayId,
                  recipients: sendable
                    .filter((c) => selected.has(c.id))
                    .map((c) => ({
                      name: c.name,
                      role: c.role,
                      email: c.email!,
                      callTime: c.callTime,
                      personId: c.personId,
                    })),
                });
                toast.success(
                  `Call sheet sent to ${selected.size} ${selected.size === 1 ? "person" : "people"}.`
                );
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Send failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : `Send to ${selected.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Sending",
    className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  },
  sent: {
    label: "Sent",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  viewed: {
    label: "Viewed",
    className: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  },
  confirmed: {
    label: "Confirmed",
    className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  },
  declined: {
    label: "Declined",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};

export function RecipientStrip({ dayId }: { dayId: Id<"shootDays"> }) {
  const recipients = useQuery(api.distribution.listForShootDay, { shootDayId: dayId });
  const [chaseOpen, setChaseOpen] = useState(false);
  if (!recipients || recipients.length === 0) return null;
  const unconfirmed = recipients.filter((r) =>
    ["pending", "sent", "viewed", "failed"].includes(r.status)
  ).length;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-6 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      {recipients.map((r) => {
        const s = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
        return (
          <span
            key={r._id}
            title={r.lastError ?? undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}
          >
            {r.name}
            <span className="opacity-70">
              · {s.label}
              {r.checkInAt ? " · On set" : ""}
            </span>
          </span>
        );
      })}
      {unconfirmed > 0 && (
        <button
          className="ml-auto text-xs font-medium text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          onClick={() => setChaseOpen(true)}
        >
          Chase {unconfirmed} unconfirmed
        </button>
      )}
      {chaseOpen && <ChaseDialog dayId={dayId} onClose={() => setChaseOpen(false)} />}
    </div>
  );
}
