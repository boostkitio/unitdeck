/**
 * Open-Meteo, in one place. Both a shoot day and a project's header want the
 * same forecast for the same reasons, and the two were drifting apart.
 */

export const WEATHER_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

export type DailyForecast = {
  summary: string;
  tempMinC: number;
  tempMaxC: number;
  precipitationProbability?: number;
  windMaxKph?: number;
  /** Local times at the location, "HH:MM", as Open-Meteo reports them. */
  sunrise: string;
  sunset: string;
  /** IANA zone for the coordinates, worth keeping for dates out of range. */
  timezone?: string;
};

/**
 * The daily forecast for one date at one point, or null when the date is
 * outside the roughly sixteen days Open-Meteo forecasts. Out of range is a
 * normal answer here, not a failure — plenty of shoots are booked further
 * ahead than that.
 */
export async function fetchDailyForecast(
  lat: number,
  lng: number,
  date: string,
): Promise<DailyForecast | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather lookup failed: ${res.status}`);
  const json = (await res.json()) as {
    timezone?: string;
    daily?: {
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: (number | null)[];
      wind_speed_10m_max: number[];
      sunrise: string[]; // ISO local, "2026-06-20T04:43"
      sunset: string[];
    };
  };

  const daily = json.daily;
  if (!daily || daily.weather_code.length === 0) return null;
  return {
    summary: WEATHER_CODES[daily.weather_code[0]] ?? "Unknown",
    tempMinC: daily.temperature_2m_min[0],
    tempMaxC: daily.temperature_2m_max[0],
    precipitationProbability: daily.precipitation_probability_max[0] ?? undefined,
    windMaxKph: daily.wind_speed_10m_max[0],
    sunrise: daily.sunrise[0]?.slice(11, 16) ?? "",
    sunset: daily.sunset[0]?.slice(11, 16) ?? "",
    timezone: json.timezone,
  };
}

/**
 * The location's IANA zone, learned from a request for today — which is always
 * inside the forecast window. Used to render sun times for a date that is not.
 */
export async function fetchTimezone(lat: number, lng: number): Promise<string | undefined> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=sunrise&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) return undefined;
  const json = (await res.json()) as { timezone?: string };
  return json.timezone;
}
