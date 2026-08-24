"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  MONTH_NAMES,
  WEEKDAYS,
  addMonths,
  dateKey,
  daysInMonth,
  leadingBlanks,
  todayKey,
  type Month,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

export type DayState = {
  /** A range endpoint, or a single selected day. */
  selected?: boolean;
  /** Between the endpoints of a range. */
  inRange?: boolean;
  /** Number of dots to draw under the number, capped at three. */
  dots?: number;
  disabled?: boolean;
};

/** `today` never changes under us mid-session, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => {};

/**
 * Today as a local "YYYY-MM-DD", or null during server render.
 *
 * The server renders in UTC and would disagree with the viewer's timezone
 * across a date boundary, so the server snapshot is null and the first client
 * pass matches it. Hydration stays clean and "today" appears immediately after.
 */
export function useToday(): string | null {
  return useSyncExternalStore(subscribeToNothing, todayKey, () => null);
}

export function MonthCalendar({
  month,
  onMonthChange,
  today,
  dayState,
  onDayClick,
  onTodayClick,
  className,
}: {
  month: Month;
  onMonthChange: (month: Month) => void;
  today: string | null;
  dayState?: (key: string) => DayState;
  onDayClick?: (key: string) => void;
  onTodayClick?: () => void;
  className?: string;
}) {
  const total = daysInMonth(month);
  const blanks = leadingBlanks(month);

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          ‹
        </Button>
        <span className="font-heading text-sm font-semibold">
          {MONTH_NAMES[month.month]} {month.year}
        </span>
        <div className="flex items-center gap-1">
          {onTodayClick && (
            <Button variant="ghost" size="sm" onClick={onTodayClick}>
              Today
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            ›
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
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
          const key = dateKey(month.year, month.month, day);
          const state = dayState?.(key) ?? {};
          const isToday = key === today;
          const dots = Math.min(state.dots ?? 0, 3);

          return (
            <div
              key={key}
              className={cn(
                // The range tint is painted on the cell so it runs edge to
                // edge, with the endpoints rounding the ends of the band.
                state.inRange && "bg-primary/15",
                state.selected && state.inRange && "bg-primary/15",
              )}
            >
              <button
                type="button"
                disabled={state.disabled}
                onClick={() => onDayClick?.(key)}
                aria-pressed={state.selected}
                className={cn(
                  "flex aspect-square w-full flex-col items-center justify-center rounded-md border border-transparent text-sm tabular-nums transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !state.disabled && "hover:bg-muted",
                  state.disabled && "cursor-not-allowed opacity-40",
                  dots > 0 ? "font-semibold text-foreground" : "text-muted-foreground",
                  isToday && "border-primary/60",
                  state.selected &&
                    "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                )}
              >
                <span>{day}</span>
                <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                  {Array.from({ length: dots }, (_, d) => (
                    <span
                      key={d}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        state.selected ? "bg-primary-foreground" : "bg-primary",
                      )}
                    />
                  ))}
                  {(state.dots ?? 0) > 3 && (
                    <span className="text-[10px] leading-none">+</span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
