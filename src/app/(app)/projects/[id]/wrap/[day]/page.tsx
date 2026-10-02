"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";
import { decodeParam, projectHref, wrapReportHref } from "@/lib/routes";
import { useCanonicalPath, useHeld, usePinnedRef } from "@/lib/use-canonical-path";

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
  params: Promise<{ id: string; day: string }>;
}) {
  const { id, day: dayParam } = use(params);
  const { organization } = useOrganization();
  // The URL holds a job number and a date, or document ids on older links.
  const { ref, pin } = usePinnedRef(id);
  const project = useHeld(
    id,
    useQuery(api.projects.getByRef, organization ? { ref } : "skip"),
  );
  pin(project?._id);
  const day = useQuery(
    api.shootDays.getByRef,
    project ? { projectId: project._id, ref: decodeParam(dayParam) } : "skip",
  );
  const report = useQuery(api.wrap.report, day ? { shootDayId: day._id } : "skip");
  const saveNotes = useMutation(api.wrap.saveNotes);
  // null = untouched this session; the textarea derives its value from the
  // server document until the first local edit, so no init effect is needed.
  const [notes, setNotes] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useCanonicalPath(project && day ? wrapReportHref(project, day.ref) : null);

  if (project === null || day === null) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">
          {project === null
            ? "Project not found."
            : "That shoot day is not on this production any more."}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          render={<Link href={project ? projectHref(project) : "/projects"} />}
        >
          {project ? "Back to project" : "Back to projects"}
        </Button>
      </div>
    );
  }

  if (!project || !day || report === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const dayId = day._id;
  const checkedIn = report.attendance.filter((a) => a.checkInAt !== null).length;

  return (
    // Printed in black whatever the theme: a dark-mode page prints its
    // near-white text onto white paper otherwise.
    <div className="mx-auto max-w-3xl print:text-black print:[&_*]:text-black">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <Link
            href={projectHref(project)}
            className="text-sm text-muted-foreground hover:underline"
          >
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
          {formatShootDate(report.date)}
          {report.label ? ` · ${report.label}` : ""}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.attendance.length === 0
            ? "Nobody was sent this day's call sheet, so there is no attendance to report."
            : `${checkedIn} of ${report.attendance.length} checked in on set`}
        </p>
      </div>

      {report.attendance.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
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
        </div>
      )}

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
          value={notes ?? report.wrapNotes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaveState("saving");
            if (timer.current) clearTimeout(timer.current);
            const value = e.target.value;
            timer.current = setTimeout(async () => {
              try {
                await saveNotes({ shootDayId: dayId, notes: value });
                setSaveState("saved");
              } catch (err) {
                // Left reading "Saving…" so the page never claims notes are
                // saved that are not; the next keystroke tries again.
                toast.error(
                  err instanceof Error ? err.message : "Could not save the wrap notes.",
                );
              }
            }, 800);
          }}
        />
      </div>
    </div>
  );
}
