"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { dayForecastIsFresh } from "../../../convex/lib/weather";
import { formatShootDate } from "@/lib/format-date";

/**
 * Sunrise, sunset and the weather for every shoot day, under the project title.
 *
 * One line per date, each at that day's own location (or the production's),
 * because a three-day shoot needs Tuesday's weather as much as Monday's.
 * Renders whatever was last stored and refreshes stale days in the background,
 * so the lines do not flicker or block on the weather service.
 */
export function ProjectForecast({
  projectId,
  projectLocationId,
  projectLocationName,
}: {
  projectId: Id<"projects">;
  projectLocationId: Id<"locations"> | null;
  projectLocationName: string | null;
}) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const refresh = useAction(api.shootDays.refreshWeatherForProject);
  const [checking, setChecking] = useState(false);

  const rows = [...(days ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const own = day.locations[0];
      return {
        day,
        locationId: own?._id ?? projectLocationId,
        locationName: own?.name ?? projectLocationName,
      };
    });
  const anyLocation = rows.some((row) => row.locationId !== null);

  // One background refresh per set of stale days, not one per render: the
  // query updates whenever the action writes, which reruns this effect.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    const now = Date.now();
    const staleKey = rows
      .filter((row) => row.locationId && !dayForecastIsFresh(row.day, row.locationId, now))
      .map((row) => `${row.day._id}:${row.locationId}`)
      .join(",");
    if (!staleKey || requested.current === staleKey) return;
    requested.current = staleKey;
    void refresh({ projectId }).catch(() => {
      // Let it be asked again rather than leaving the lines checking for good.
      requested.current = null;
    });
    // `rows` is rebuilt every render; `days` is what it is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, days, projectLocationId, refresh]);

  /** Asks again now for every day, whatever was stored. */
  async function refreshNow() {
    setChecking(true);
    try {
      await refresh({ projectId, force: true });
      toast.success("Weather updated for every shoot day.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check the forecast.");
    } finally {
      setChecking(false);
    }
  }

  if (days === undefined || rows.length === 0) return null;
  if (!anyLocation) {
    return (
      <p className="px-2 text-xs text-muted-foreground">
        Add a location to this project to see sunrise, sunset and the weather for each shoot day.
      </p>
    );
  }

  return (
    <div className="space-y-0.5 px-2 text-xs text-muted-foreground">
      {rows.map(({ day, locationId, locationName }) => {
        const weather = day.weather;
        const checked = day.forecastCheckedAt !== undefined && day.forecastLocationId === (locationId ?? undefined);
        return (
          <div key={day._id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-medium text-foreground">{formatShootDate(day.date)}</span>
            {locationName && <span className="truncate">{locationName}</span>}
            {!locationId ? (
              <span>No location for this day</span>
            ) : !checked ? (
              <span>Checking the forecast…</span>
            ) : (
              <>
                {day.sun && (
                  <span>
                    Sunrise {day.sun.sunrise} · Sunset {day.sun.sunset}
                  </span>
                )}
                {weather && (
                  <span className="text-foreground">
                    {weather.summary} · {Math.round(weather.tempMinC)}–
                    {Math.round(weather.tempMaxC)}°C
                  </span>
                )}
                {weather?.precipitationProbability !== undefined &&
                  weather.precipitationProbability > 0 && (
                    <span>{Math.round(weather.precipitationProbability)}% rain</span>
                  )}
                {weather?.windMaxKph !== undefined && weather.windMaxKph >= 30 && (
                  // Flagged rather than buried: it decides whether a jib or a
                  // 12x12 goes up.
                  <span className="text-amber-700 dark:text-amber-400">
                    Wind {Math.round(weather.windMaxKph)} km/h
                  </span>
                )}
                {day.forecastReason && <span>{day.forecastReason}</span>}
              </>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void refreshNow()}
        disabled={checking}
        title="Check the forecast again now for every shoot day"
        className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      >
        {checking ? "Checking…" : "Refresh weather"}
      </button>
    </div>
  );
}
