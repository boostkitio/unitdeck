"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { type UpcomingShootDay } from "../../../convex/dashboard";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Monday-first, matching UK production week conventions.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Month = { year: number; month: number }; // month is 0-indexed

/** "YYYY-MM-DD" from local calendar parts, avoiding any UTC shift. */
function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth({ year, month }: Month): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/** Blank cells before the 1st, with Monday as column 0. */
function leadingBlanks({ year, month }: Month): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function addMonths({ year, month }: Month, delta: number): Month {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

/** Today as a local "YYYY-MM-DD". Client-only: see ShootCalendar. */
function todayKey(): string {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** `today` never changes under us mid-session, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => {};

function formatDayLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

function ShootEntry({ day }: { day: UpcomingShootDay }) {
  return (
    <li>
      <Link
        href={`/projects/${day.projectId}/shoot-days/${day.shootDayId}/call-sheet`}
        className="flex flex-col gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-foreground">{day.projectName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{day.date}</span>
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
  // "today" is client-only: the server renders in UTC and would disagree with
  // the viewer's timezone across a date boundary. Returning null as the server
  // snapshot keeps the first client pass identical, so hydration stays clean.
  const today = useSyncExternalStore(subscribeToNothing, todayKey, () => null);
  // The visible month is an offset from today's month rather than an absolute
  // date, so no state has to be seeded from that client-only value.
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const cursor = useMemo<Month | null>(() => {
    if (!today) return null;
    const [year, month] = today.split("-").map(Number);
    return addMonths({ year, month: month - 1 }, monthOffset);
  }, [today, monthOffset]);

  const range = useMemo(() => {
    if (!cursor) return null;
    return {
      from: dateKey(cursor.year, cursor.month, 1),
      to: dateKey(cursor.year, cursor.month, daysInMonth(cursor)),
    };
  }, [cursor]);

  const shoots = useQuery(api.dashboard.shootDaysInRange, range ?? "skip");

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

  if (!cursor || !range) {
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

  const total = daysInMonth(cursor);
  const blanks = leadingBlanks(cursor);
  const selectedShoots = selected ? (byDate.get(selected) ?? []) : null;

  function goToMonth(delta: number) {
    setMonthOffset((current) => current + delta);
    setSelected(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </CardTitle>
        <CardAction>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous month"
              onClick={() => goToMonth(-1)}
            >
              ‹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMonthOffset(0);
                setSelected(null);
              }}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next month"
              onClick={() => goToMonth(1)}
            >
              ›
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="pb-1 text-xs font-medium text-muted-foreground">
              {weekday}
            </div>
          ))}

          {Array.from({ length: blanks }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}

          {Array.from({ length: total }, (_, i) => {
            const day = i + 1;
            const key = dateKey(cursor.year, cursor.month, day);
            const dayShoots = byDate.get(key) ?? [];
            const isToday = key === today;
            const isSelected = key === selected;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(isSelected ? null : key)}
                aria-label={`${formatDayLabel(key)}, ${dayShoots.length} shoot day${
                  dayShoots.length === 1 ? "" : "s"
                }`}
                aria-pressed={isSelected}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center rounded-md border border-transparent text-sm tabular-nums transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  dayShoots.length > 0 && "font-semibold text-foreground",
                  dayShoots.length === 0 && "text-muted-foreground",
                  isToday && "border-primary/60",
                  isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                <span>{day}</span>
                <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                  {dayShoots.slice(0, 3).map((shoot) => (
                    <span
                      key={shoot.shootDayId}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isSelected ? "bg-primary-foreground" : "bg-primary",
                      )}
                    />
                  ))}
                  {dayShoots.length > 3 && (
                    <span className="text-[10px] leading-none">+</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 border-t border-border pt-3 text-sm">
          {shoots === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : selectedShoots !== null ? (
            selectedShoots.length === 0 ? (
              <p className="text-muted-foreground">
                No shoots on {formatDayLabel(selected!)}.
              </p>
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {selectedShoots.map((shoot) => (
                  <ShootEntry key={shoot.shootDayId} day={shoot} />
                ))}
              </ul>
            )
          ) : monthShoots.length === 0 ? (
            <p className="text-muted-foreground">
              No shoot days in {MONTH_NAMES[cursor.month]}. Use ‹ and › to look at other months.
            </p>
          ) : (
            <ul className="-mx-2 max-h-64 divide-y divide-border overflow-y-auto">
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
