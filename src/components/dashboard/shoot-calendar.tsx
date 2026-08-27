"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { type UpcomingShootDay } from "../../../convex/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthCalendar, useToday, type DayState } from "@/components/ui/month-calendar";
import { MONTH_NAMES, dateKey, daysInMonth, monthOf, type Month } from "@/lib/calendar";
import { formatShootDate } from "@/lib/format-date";

function ShootEntry({ day }: { day: UpcomingShootDay }) {
  return (
    <li>
      <Link
        href={`/projects/${day.projectId}/shoot-days/${day.shootDayId}/call-sheet`}
        className="flex flex-col gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-foreground">{day.projectName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatShootDate(day.date)}
          </span>
        </div>
        {day.label && <p className="truncate text-xs text-muted-foreground">{day.label}</p>}
        {day.locationName && (
          <p className="truncate text-xs text-muted-foreground">{day.locationName}</p>
        )}
        {day.total > 0 && (
          <p className="text-xs text-muted-foreground">
            {day.confirmed} of {day.total} confirmed
          </p>
        )}
      </Link>
    </li>
  );
}

export function ShootCalendar() {
  const today = useToday();
  const [monthOverride, setMonthOverride] = useState<Month | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const month = monthOverride ?? (today ? monthOf(today) : null);

  const range = useMemo(() => {
    if (!month) return null;
    return {
      from: dateKey(month.year, month.month, 1),
      to: dateKey(month.year, month.month, daysInMonth(month)),
    };
  }, [month]);

  const shoots = useQuery(api.dashboard.shootDaysInRange, range ?? "skip");
  // What the office's own people already have on. Read-only, and read from
  // their Google calendars: it is here so a shoot is not booked over
  // somebody's holiday, not to be edited.
  const busy = useQuery(api.calendarSync.busy, range ?? "skip");

  // date -> shoots on that date, for O(1) lookup while painting cells.
  const byDate = useMemo(() => {
    const map = new Map<string, UpcomingShootDay[]>();
    for (const shoot of shoots ?? []) {
      const existing = map.get(shoot.date);
      if (existing) existing.push(shoot);
      else map.set(shoot.date, [shoot]);
    }
    return map;
  }, [shoots]);

  const monthShoots = useMemo(
    () => [...(shoots ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [shoots],
  );

  if (!month) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const selectedShoots = selected ? (byDate.get(selected) ?? []) : null;

  const dayState = (key: string): DayState => ({
    selected: key === selected,
    dots: byDate.get(key)?.length ?? 0,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
      </CardHeader>
      <CardContent>
        <MonthCalendar
          month={month}
          onMonthChange={(next) => {
            setMonthOverride(next);
            setSelected(null);
          }}
          today={today}
          dayState={dayState}
          onDayClick={(key) => setSelected(key === selected ? null : key)}
          onTodayClick={() => {
            setMonthOverride(today ? monthOf(today) : null);
            setSelected(null);
          }}
        />

        <div className="mt-4 border-t border-border pt-3 text-sm">
          {shoots === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : selectedShoots !== null ? (
            <>
              {selectedShoots.length === 0 ? (
                <p className="text-muted-foreground">No shoots on {formatShootDate(selected!)}.</p>
              ) : (
                <ul className="-mx-2 divide-y divide-border">
                  {selectedShoots.map((shoot) => (
                    <ShootEntry key={shoot.shootDayId} day={shoot} />
                  ))}
                </ul>
              )}
              <OtherCommitments busy={busy ?? []} date={selected!} />
            </>
          ) : monthShoots.length === 0 ? (
            <p className="text-muted-foreground">
              No shoot days in {MONTH_NAMES[month.month]}. Use ‹ and › to look at other months.
            </p>
          ) : (
            <ul className="-mx-2 max-h-48 divide-y divide-border overflow-y-auto">
              {monthShoots.map((shoot) => (
                <ShootEntry key={shoot.shootDayId} day={shoot} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


/**
 * What your own people already have on that day.
 *
 * Read from their Google calendars and shown here so a shoot is not booked
 * over a holiday or a hospital appointment. Nothing here can be edited — these
 * are their entries, not ours, and UnitDeck never writes to them.
 */
function OtherCommitments({
  busy,
  date,
}: {
  busy: { personId: string; name: string; summary: string; startDate: string; endDate: string }[];
  date: string;
}) {
  const onThisDay = busy.filter((entry) => entry.startDate <= date && entry.endDate >= date);
  if (onThisDay.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">Also on that day</p>
      <ul className="mt-1 space-y-1">
        {onThisDay.map((entry, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs">
            <span className="shrink-0 font-medium text-foreground">{entry.name}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.summary}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        From their own calendars. UnitDeck does not change these.
      </p>
    </div>
  );
}
