"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@clerk/nextjs";
import { statusBadgeClass, statusLabel } from "@/lib/project-status";
import { ShootCalendar } from "@/components/dashboard/shoot-calendar";
import { cn } from "@/lib/utils";

// ── Inline sub-components ────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  href,
  warn,
}: {
  label: string;
  value: number | undefined;
  href?: string;
  warn?: boolean;
}) {
  const inner = (
    <Card
      className={cn(
        "transition-colors",
        href && "cursor-pointer hover:bg-muted/50",
        warn && "border-amber-400/40 dark:border-amber-500/30",
      )}
    >
      <CardHeader className="pb-1">
        <CardTitle
          className={cn(
            "text-xs font-medium",
            warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          <Skeleton className="h-9 w-12" />
        ) : (
          <span
            className={cn(
              "font-heading text-4xl tabular-nums font-semibold leading-none",
              warn && value > 0 ? "text-amber-600 dark:text-amber-400" : "",
            )}
          >
            {value}
          </span>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { organization } = useOrganization();
  const projects = useQuery(api.projects.list, organization ? {} : "skip");
  const people = useQuery(api.people.list, organization ? {} : "skip");
  const attention = useQuery(api.dashboard.attention, organization ? {} : "skip");
  const week = useQuery(api.dashboard.upcomingShootDays, organization ? {} : "skip");
  const seedDemo = useMutation(api.demoData.seedDemo);
  const [seeding, setSeeding] = useState(false);

  async function handleLoadSampleData() {
    setSeeding(true);
    try {
      const res = await seedDemo({});
      if (res.seeded) {
        toast.success("Sample data loaded.");
      } else {
        toast.info("Sample data is already loaded.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sample data.");
    } finally {
      setSeeding(false);
    }
  }

  if (!organization) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="text-base font-medium text-foreground">
          Create or select an organisation to get started.
        </p>
        <p className="mt-2 text-sm">Use the organisation switcher in the sidebar.</p>
      </div>
    );
  }

  // projects.list already excludes archived, and the booking model has no
  // "finished" status, so everything it returns is active work.
  const active = projects;

  // Hero summary line
  const weekCount = week?.length ?? 0;
  const attentionCount = attention?.length ?? 0;
  const summaryReady = week !== undefined && attention !== undefined;
  const summaryText = summaryReady
    ? `${weekCount} shoot day${weekCount !== 1 ? "s" : ""} this week · ${attentionCount} item${attentionCount !== 1 ? "s" : ""} need${attentionCount === 1 ? "s" : ""} attention`
    : null;

  return (
    <div className="space-y-6 pb-8">
      {/* Hero band */}
      <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#11182F,#34406B_58%,#6B7FBE)] px-6 py-8 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Command centre
            </h1>
            {summaryText ? (
              <p className="mt-1 text-sm text-white/70">{summaryText}</p>
            ) : (
              <Skeleton className="mt-2 h-4 w-56 bg-white/20" />
            )}
          </div>
          <Button
            render={<Link href="/projects" />}
            className="w-fit shrink-0 border-white/30 bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/40"
          >
            + New project
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Active projects"
          value={active?.length}
          href="/projects"
        />
        <StatTile
          label="Crew"
          value={people?.length}
          href="/people"
        />
        <StatTile
          label="Upcoming"
          value={week?.length}
          href="/projects"
        />
        <StatTile
          label="Needs attention"
          value={attention?.length}
          warn
        />
      </div>

      {/* Two-column row: attention + schedule */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Needs attention */}
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {attention === undefined || active === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : attention.length > 0 ? (
              // Items first: the count in the tile above must never disagree
              // with what this panel shows.
              <ul className="divide-y divide-border">
                {attention.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.projectName} · {formatShootDate(item.date)}
                      </p>
                    </div>
                    <Link
                      className="shrink-0 text-xs text-primary underline underline-offset-2"
                      href={`/projects/${item.projectId}`}
                    >
                      Open project
                    </Link>
                  </li>
                ))}
              </ul>
            ) : active.length === 0 ? (
              <p className="text-muted-foreground">
                No active projects yet.{" "}
                <Link className="underline underline-offset-2 text-foreground" href="/projects">
                  Create your first project
                </Link>{" "}
                to get going.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Nothing needs attention. Crew not booked, crew still to confirm, kit
                double-booked with another shoot, or weather risk will appear here.
              </p>
            )}
          </CardContent>
        </Card>

        <ShootCalendar />
      </div>

      {/* Active productions */}
      <Card>
        <CardHeader>
          <CardTitle>Active productions</CardTitle>
          <CardAction>
            <Link
              href="/projects"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              View all
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm">
          {active === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          ) : active.length === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                No active productions.{" "}
                <Link className="underline underline-offset-2 text-foreground" href="/projects">
                  Start a new project
                </Link>{" "}
                to see it here.
              </p>
              <Button variant="secondary" onClick={handleLoadSampleData} disabled={seeding}>
                {seeding ? "Loading sample data…" : "Load sample data"}
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {active.map((p) => (
                <li key={p._id}>
                  <Link
                    href={`/projects/${encodeURIComponent(p.jobNumber ?? p._id)}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:text-foreground"
                  >
                    <span className="truncate font-medium text-foreground">{p.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                        statusBadgeClass(p.status),
                      )}
                    >
                      {statusLabel(p.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
