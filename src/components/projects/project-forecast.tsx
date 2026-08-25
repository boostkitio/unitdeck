"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { formatShootDate } from "@/lib/format-date";
import { isStale } from "@/lib/forecast";

type Forecast = {
  date: string;
  locationId: Id<"locations">;
  fetchedAt: number;
  reason?: string;
  summary?: string;
  tempMinC?: number;
  tempMaxC?: number;
  precipitationProbability?: number;
  windMaxKph?: number;
  sunrise?: string;
  sunset?: string;
};

/**
 * Sunrise, sunset and the weather for the shoot, under the project title.
 *
 * Renders whatever was last stored and refreshes in the background, so the
 * line does not flicker or block on the weather service. Nothing is shown
 * until there is both a shoot date and a located project — an empty strip
 * under every title would be worse than none.
 */
export function ProjectForecast({
  projectId,
  forecast,
  date,
  locationId,
  locationName,
}: {
  projectId: Id<"projects">;
  forecast: Forecast | undefined;
  date: string | null;
  locationId: Id<"locations"> | null;
  locationName: string | null;
}) {
  const refresh = useAction(api.projects.refreshForecast);
  const [checking, setChecking] = useState(false);

  // One refresh per stale combination, not one per render: the effect reruns
  // whenever the query updates, and the action's own write is such an update.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!date || !locationId) return;
    if (!isStale(forecast, date, locationId, Date.now())) return;
    const key = `${projectId}:${date}:${locationId}`;
    if (requested.current === key) return;
    requested.current = key;
    void refresh({ id: projectId }).catch(() => {
      // Clear the guard so this can be tried again. Holding it meant one
      // failed lookup left the line reading "Checking the forecast…" for
      // good, with no way to ask it to try again.
      requested.current = null;
    });
  }, [projectId, forecast, date, locationId, refresh]);

  /** Asks again now, whatever the cache thinks. */
  async function refreshNow() {
    setChecking(true);
    try {
      requested.current = null;
      const result = await refresh({ id: projectId });
      if (result.ok) toast.success(result.reason ?? "Forecast updated.");
      else toast.error(result.reason ?? "Could not check the forecast.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check the forecast.");
    } finally {
      setChecking(false);
    }
  }

  if (!date) return null;
  if (!locationId) {
    return (
      <p className="px-2 text-xs text-muted-foreground">
        Add a location to this project to see sunrise, sunset and the weather for the shoot.
      </p>
    );
  }
  if (!forecast || forecast.date !== date) {
    return (
      <p className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        Checking the forecast…
        <button
          type="button"
          onClick={() => void refreshNow()}
          disabled={checking}
          className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </p>
    );
  }

  const temperature =
    forecast.tempMinC !== undefined && forecast.tempMaxC !== undefined
      ? `${Math.round(forecast.tempMinC)}–${Math.round(forecast.tempMaxC)}°C`
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{formatShootDate(date)}</span>
      {locationName && <span className="truncate">{locationName}</span>}

      {forecast.sunrise && forecast.sunset && (
        <span>
          Sunrise {forecast.sunrise} · Sunset {forecast.sunset}
        </span>
      )}

      {forecast.summary && (
        <span className="text-foreground">
          {forecast.summary}
          {temperature && ` · ${temperature}`}
        </span>
      )}

      {forecast.precipitationProbability !== undefined &&
        forecast.precipitationProbability > 0 && (
          <span>{Math.round(forecast.precipitationProbability)}% rain</span>
        )}

      {forecast.windMaxKph !== undefined && forecast.windMaxKph >= 30 && (
        // Worth flagging rather than burying: it is the number that decides
        // whether a jib or a 12x12 goes up.
        <span className="text-amber-700 dark:text-amber-400">
          Wind {Math.round(forecast.windMaxKph)} km/h
        </span>
      )}

      {forecast.reason && <span>{forecast.reason}</span>}

      <button
        type="button"
        onClick={() => void refreshNow()}
        disabled={checking}
        title="Check the forecast again now"
        className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      >
        {checking ? "Checking…" : "Refresh"}
      </button>
    </div>
  );
}
