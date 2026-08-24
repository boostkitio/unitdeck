"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";

/**
 * Call sheets are per shoot day, so this section is a launcher: one row per
 * day on the schedule, each opening that day's call sheet composer.
 */
export function CallSheetSection({ projectId }: { projectId: Id<"projects"> }) {
  const days = useQuery(api.shootDays.listForProject, { projectId });

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Generate call sheet</CardTitle>
      </CardHeader>
      <CardContent>
        {days === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : days.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Add a shoot day above to generate a call sheet for it.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {days.map((day) => (
              <li key={day._id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {formatShootDate(day.date)}
                    {day.label ? ` · ${day.label}` : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {day.locations.length > 0
                      ? day.locations.map((l) => l.name).join(", ")
                      : "No locations"}
                  </p>
                </div>
                <Link
                  href={`/projects/${projectId}/shoot-days/${day._id}/call-sheet`}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                >
                  Generate call sheet
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
