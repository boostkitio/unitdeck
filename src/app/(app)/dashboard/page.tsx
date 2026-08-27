"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDate } from "@/lib/format-date";
import { groupAttentionByProject } from "@/lib/group-attention";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@clerk/nextjs";
import { statusBadgeClass, statusLabel } from "@/lib/project-status";
import { ShootCalendar } from "@/components/dashboard/shoot-calendar";
import { NewQuoteDialog } from "@/components/quotes/new-quote-dialog";
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
  const [quoting, setQuoting] = useState(false);

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
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              render={<Link href="/projects" />}
              className="w-fit shrink-0 border-white/30 bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/40"
            >
              + New project
            </Button>
            {/* Straight into the quote, not to the Quotes tab: a quote is
                usually started off the back of a phone call, and it does not
                need a production to belong to. */}
            <Button
              onClick={() => setQuoting(true)}
              className="w-fit shrink-0 border-white/30 bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/40"
            >
              + New quote
            </Button>
          </div>
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
        {/*
          Needs attention. On two columns the card is taken out of flow, so the
          calendar beside it is the only thing setting the row's height and the
          card fills it. Left in flow the card would push the row taller with
          every item added — the list growing forever and never scrolling, and
          the calendar stretched to match. On one column nothing sets a height,
          so it is capped instead.
        */}
        <div className="relative">
        <Card className="max-h-[32rem] lg:absolute lg:inset-0 lg:max-h-none">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col text-sm">
            {attention === undefined || active === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : attention.length > 0 ? (
              // Items first: the count in the tile above must never disagree
              // with what this panel shows.
              // Fills the card, then scrolls — rather than stopping short of
              // the bottom with the height already spoken for.
              // Grouped by production: flat, the name and the link repeated on
              // every line, so four things missing from one job read as four
              // separate problems instead of one job to pick up.
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                {groupAttentionByProject(attention).map((group) => (
                  <li key={String(group.projectId)} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate font-medium text-foreground">
                        {group.projectName}
                        <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                          {group.items.length}
                        </span>
                      </p>
                      <Link
                        className="shrink-0 text-xs text-primary underline underline-offset-2"
                        href={`/projects/${group.projectId}`}
                      >
                        Open project
                      </Link>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {group.items.map((item, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-xs">
                          <span className="text-muted-foreground" aria-hidden="true">
                            &middot;
                          </span>
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {item.label}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {item.date ? formatShootDate(item.date) : "No dates"}
                          </span>
                        </li>
                      ))}
                    </ul>
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
                Nothing needs attention. Crew still to book or confirm, kit still to
                confirm or double-booked with another shoot, release forms nobody has
                signed, a job with no dates, client, location or running order, and
                weather risk will all appear here.
              </p>
            )}
          </CardContent>
        </Card>
        </div>

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

      {quoting && <NewQuoteDialog onClose={() => setQuoting(false)} />}
    </div>
  );
}
