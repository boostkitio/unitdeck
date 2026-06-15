"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../../../../../convex/_generated/api";
import { Id } from "../../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_TEXT: Record<string, string> = {
  pending: "Not sent",
  sent: "Sent, no response",
  failed: "Email failed",
  viewed: "Viewed only",
  confirmed: "Confirmed",
  declined: "Declined",
};

function time(ts: number | null): string {
  if (!ts) return "–";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function WrapPage({
  params,
}: {
  params: Promise<{ id: string; shootDayId: string }>;
}) {
  const { id, shootDayId } = use(params);
  const dayId = shootDayId as Id<"shootDays">;
  const { organization } = useOrganization();
  const report = useQuery(api.wrap.report, organization ? { shootDayId: dayId } : "skip");
  const saveNotes = useMutation(api.wrap.saveNotes);
  const [notes, setNotes] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialise notes once from the server document
  useEffect(() => {
    if (report && notes === null) setNotes(report.wrapNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  if (!organization || report === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const checkedIn = report.attendance.filter((a) => a.checkInAt !== null).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <Link href={`/projects/${id}`} className="text-sm text-muted-foreground hover:underline">
            ← Back to project
          </Link>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Wrap report</h1>
        </div>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="mt-6">
        <p className="text-sm text-muted-foreground">{report.projectName}</p>
        <p className="text-lg font-medium">
          {report.date}
          {report.label ? ` · ${report.label}` : ""}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {checkedIn} of {report.attendance.length} checked in on set
        </p>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-2 font-semibold">Name</th>
            <th className="py-2 pr-2 font-semibold">Role</th>
            <th className="py-2 pr-2 font-semibold">Call</th>
            <th className="py-2 pr-2 font-semibold">Response</th>
            <th className="py-2 pr-2 font-semibold">Checked in</th>
            <th className="py-2 font-semibold">Safety ack</th>
          </tr>
        </thead>
        <tbody>
          {report.attendance.map((a, i) => (
            <tr key={i} className="border-b border-border">
              <td className="py-2 pr-2 font-medium">{a.name}</td>
              <td className="py-2 pr-2">{a.role}</td>
              <td className="py-2 pr-2 tabular-nums">{a.callTime}</td>
              <td className="py-2 pr-2">{STATUS_TEXT[a.status] ?? a.status}</td>
              <td className="py-2 pr-2 tabular-nums">{time(a.checkInAt)}</td>
              <td className="py-2 tabular-nums">{time(a.safetyAckAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Wrap notes</h2>
          <span className="text-xs text-muted-foreground print:hidden">
            {saveState === "saved" ? "Saved" : "Saving…"}
          </span>
        </div>
        <Textarea
          className="mt-2 print:border-0 print:p-0"
          rows={6}
          placeholder="Overruns, pickups needed, kit issues, anything for the post team…"
          value={notes ?? ""}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaveState("saving");
            if (timer.current) clearTimeout(timer.current);
            const value = e.target.value;
            timer.current = setTimeout(async () => {
              await saveNotes({ shootDayId: dayId, notes: value });
              setSaveState("saved");
            }, 800);
          }}
        />
      </div>
    </div>
  );
}
