"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { type UpcomingShootDay } from "../../../../convex/dashboard";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@clerk/nextjs";
import { statusBadgeClass, statusLabel } from "@/lib/project-status";
import { cn } from "@/lib/utils";

const ACTIVE_STATUSES = ["brief", "pre_production", "shooting", "post"] as const;

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

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,#34406B,#6B7FBE)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ShootDayRow({ day }: { day: UpcomingShootDay }) {
  return (
    <li>
      <Link
        href={`/projects/${day.projectId}/shoot-days/${day.shootDayId}/call-sheet`}
        className="flex flex-col gap-0.5 rounded-lg px-1 py-2.5 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-foreground">{day.projectName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{day.date}</span>
        </div>
        {day.label && (
          <p className="truncate text-xs text-muted-foreground">{day.label}</p>
        )}
        {day.locationName && (
          <p className="truncate text-xs text-muted-foreground">{day.locationName}</p>
        )}
        {day.total > 0 && (
          <>
            <ProgressBar value={day.confirmed} max={day.total} />
            <p className="text-xs text-muted-foreground">
              {day.confirmed} of {day.total} confirmed
            </p>
          </>
        )}
      </Link>
    </li>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { organization } = useOrganization();
  const projects = useQuery(api.projects.list, organization ? {} : "skip");
  const people = useQuery(api.people.list, organization ? {} : "skip");
  const attention = useQuery(api.dashboard.attention, organization ? {} : "skip");
  const week = useQuery(api.dashboard.upcomingShootDays, organization ? {} : "skip");

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

  const active = projects?.filter((p) =>
    ACTIVE_STATUSES.includes(p.status as (typeof ACTIVE_STATUSES)[number]),
  );

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

      {/* Two-column row: attention + this week */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
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
            ) : active.length === 0 ? (
              <p className="text-muted-foreground">
                No active projects yet.{" "}
                <Link className="underline underline-offset-2 text-foreground" href="/projects">
                  Create your first project
                </Link>{" "}
                to get going.
              </p>
            ) : attention.length === 0 ? (
              <p className="text-muted-foreground">
                Nothing needs attention. Upcoming shoot days with unsent call sheets, unconfirmed
                crew or weather risk will appear here.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {attention.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.projectName} · {item.date}
                      </p>
                    </div>
                    <Link
                      className="shrink-0 text-xs text-primary underline underline-offset-2"
                      href={`/projects/${item.projectId}/shoot-days/${item.shootDayId}/call-sheet`}
                    >
                      Open call sheet
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* This week */}
        <Card>
          <CardHeader>
            <CardTitle>This week</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {week === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : week.length === 0 ? (
              <p className="text-muted-foreground">No shoot days in the next 7 days.</p>
            ) : (
              <ul className="divide-y divide-border -mx-1">
                {week.map((day) => (
                  <ShootDayRow key={day.shootDayId} day={day} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
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
            <p className="text-muted-foreground">
              No active productions.{" "}
              <Link className="underline underline-offset-2 text-foreground" href="/projects">
                Start a new project
              </Link>{" "}
              to see it here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {active.map((p) => (
                <li key={p._id}>
                  <Link
                    href={`/projects/${p._id}`}
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
