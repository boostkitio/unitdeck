"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CallSheetComposer } from "@/components/call-sheet/call-sheet-composer";

/**
 * The production's combined call sheet: several dates on one document, kept
 * apart from each date's own sheet. It is generated from the Call sheet
 * section on the project, and opened from there.
 */
export default function CombinedCallSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { organization } = useOrganization();
  // The URL holds a job number, or a document id on older links.
  const project = useQuery(api.projects.getByRef, organization ? { ref: id } : "skip");
  const draft = useQuery(
    api.callSheets.getCurrentCombined,
    project ? { projectId: project._id } : "skip",
  );

  if (!organization || project === undefined || (project && draft === undefined)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (project === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Project not found.</p>;
  }
  if (!draft) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">
          This production has no combined call sheet yet. Generate one from the Call sheet section
          on the project.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" render={<Link href={`/projects/${id}`} />}>
          Back to project
        </Button>
      </div>
    );
  }

  // Keyed by draft id: snapshot/restore create a new draft row and remount
  return (
    <CallSheetComposer
      key={draft._id}
      draft={draft}
      target={{ kind: "combined", projectId: project._id }}
      backHref={`/projects/${id}`}
    />
  );
}
