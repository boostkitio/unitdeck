"use client";

import { use, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { api } from "../../../../../../../../convex/_generated/api";
import { Id } from "../../../../../../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { CallSheetComposer } from "@/components/call-sheet/call-sheet-composer";

export default function CallSheetPage({
  params,
}: {
  params: Promise<{ id: string; shootDayId: string }>;
}) {
  const { id, shootDayId } = use(params);
  const dayId = shootDayId as Id<"shootDays">;
  const { organization } = useOrganization();
  const ensure = useMutation(api.callSheets.ensure);
  const draft = useQuery(api.callSheets.getCurrent, organization ? { shootDayId: dayId } : "skip");

  // First visit: create version 1 from shoot day defaults
  useEffect(() => {
    if (organization && draft === null) {
      void ensure({ shootDayId: dayId });
    }
  }, [organization, draft, ensure, dayId]);

  if (!organization || draft === undefined || draft === null) {
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
      target={{ kind: "day", dayId }}
      backHref={`/projects/${id}`}
    />
  );
}
