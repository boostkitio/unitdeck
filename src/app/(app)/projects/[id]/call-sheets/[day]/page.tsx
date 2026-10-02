"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallSheetComposer } from "@/components/call-sheet/call-sheet-composer";
import { callSheetHref, decodeParam, projectHref } from "@/lib/routes";
import { useCanonicalPath, useHeld, usePinnedRef } from "@/lib/use-canonical-path";

/**
 * One shoot day's call sheet, addressed by the production's job number and
 * the day's date. Older links carry document ids in both places; each is read
 * as well, and the address then moves to the readable one.
 */
export default function CallSheetPage({
  params,
}: {
  params: Promise<{ id: string; day: string }>;
}) {
  const { id, day: dayParam } = use(params);
  const { organization } = useOrganization();
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
  const ensure = useMutation(api.callSheets.ensure);
  const draft = useQuery(api.callSheets.getCurrent, day ? { shootDayId: day._id } : "skip");

  useCanonicalPath(project && day ? callSheetHref(project, day.ref) : null);

  // First visit: create version 1 from shoot day defaults
  useEffect(() => {
    if (day && draft === null) {
      void ensure({ shootDayId: day._id });
    }
  }, [day, draft, ensure]);

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

  if (!project || !day || !draft) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Keyed by draft id: snapshot/restore create a new draft row and remount
  return (
    <CallSheetComposer
      key={draft._id}
      draft={draft}
      target={{ kind: "day", dayId: day._id }}
      backHref={projectHref(project)}
    />
  );
}
