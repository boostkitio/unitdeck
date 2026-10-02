import { describe, expect, it } from "vitest";
import { dayForecastIsFresh, FORECAST_FRESH_MS, FORECAST_FRESH_MS_WITHOUT_WEATHER } from "./weather";

const NOW = 1_800_000_000_000;
const weather = { fetchedAt: NOW, summary: "Clear", tempMinC: 10, tempMaxC: 18 };

describe("dayForecastIsFresh", () => {
  it("asks for a day that has never been checked", () => {
    expect(dayForecastIsFresh({}, "loc_1", NOW)).toBe(false);
  });

  it("asks again when the day's location has changed", () => {
    const day = { forecastCheckedAt: NOW, forecastLocationId: "loc_1", weather };
    expect(dayForecastIsFresh(day, "loc_1", NOW)).toBe(true);
    expect(dayForecastIsFresh(day, "loc_2", NOW)).toBe(false);
  });

  it("keeps a forecast for three hours, and sun times alone for a day", () => {
    const forecast = { forecastCheckedAt: NOW, forecastLocationId: "loc_1", weather };
    expect(dayForecastIsFresh(forecast, "loc_1", NOW + FORECAST_FRESH_MS)).toBe(true);
    expect(dayForecastIsFresh(forecast, "loc_1", NOW + FORECAST_FRESH_MS + 1)).toBe(false);

    const tooFarAhead = { forecastCheckedAt: NOW, forecastLocationId: "loc_1", forecastReason: "Too far ahead" };
    expect(dayForecastIsFresh(tooFarAhead, "loc_1", NOW + FORECAST_FRESH_MS + 1)).toBe(true);
    expect(dayForecastIsFresh(tooFarAhead, "loc_1", NOW + FORECAST_FRESH_MS_WITHOUT_WEATHER + 1)).toBe(false);
  });
});
