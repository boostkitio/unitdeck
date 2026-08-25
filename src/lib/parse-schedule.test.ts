import { describe, expect, it } from "vitest";
import {
  matchDay,
  parseSchedule,
  readDate,
  takeLeadingTime,
  type ParsedScheduleLine,
} from "./parse-schedule";

describe("takeLeadingTime", () => {
  it("reads the usual twenty-four hour clock", () => {
    expect(takeLeadingTime("07:00 Crew call")).toEqual({ time: "07:00", rest: "Crew call" });
    expect(takeLeadingTime("19:45 Wrap")).toMatchObject({ time: "19:45" });
  });

  it("reads a full stop as a colon, which is how half of us type it", () => {
    expect(takeLeadingTime("7.30 Breakfast")).toMatchObject({ time: "07:30" });
  });

  it("reads am and pm", () => {
    expect(takeLeadingTime("7am Crew call")).toMatchObject({ time: "07:00" });
    expect(takeLeadingTime("1pm Lunch")).toMatchObject({ time: "13:00" });
    expect(takeLeadingTime("12am Midnight")).toMatchObject({ time: "00:00" });
    expect(takeLeadingTime("12pm Noon")).toMatchObject({ time: "12:00" });
    expect(takeLeadingTime("7.30pm Dinner")).toMatchObject({ time: "19:30" });
  });

  it("takes the start of a range", () => {
    expect(takeLeadingTime("08:00–08:30 Setup")).toMatchObject({ time: "08:00" });
    expect(takeLeadingTime("08:00 - 09:00 Setup")).toMatchObject({ time: "08:00" });
    expect(takeLeadingTime("7-8pm Dinner")).toMatchObject({ time: "19:00" });
  });

  it("reads four digits written military style", () => {
    expect(takeLeadingTime("0700 Crew call")).toMatchObject({ time: "07:00" });
  });

  it("refuses a bare number, which is far more often an address", () => {
    expect(takeLeadingTime("24 Studio Way")).toEqual({ time: null, rest: "24 Studio Way" });
    expect(takeLeadingTime("2 x 2K HMI")).toEqual({ time: null, rest: "2 x 2K HMI" });
  });

  it("refuses an impossible clock reading", () => {
    expect(takeLeadingTime("99:99 Nonsense")).toMatchObject({ time: null });
    expect(takeLeadingTime("25:00 Nonsense")).toMatchObject({ time: null });
  });
});

describe("readDate", () => {
  it("reads an ISO date", () => {
    expect(readDate("Day 1 — 2026-05-12")).toBe("2026-05-12");
  });

  it("reads a day-first date, as the rest of the app does", () => {
    expect(readDate("12/05/2026")).toBe("2026-05-12");
    expect(readDate("12-05-26")).toBe("2026-05-12");
  });

  it("reads a written month either way round", () => {
    expect(readDate("Tuesday 12 May 2026")).toBe("2026-05-12");
    expect(readDate("May 12, 2026")).toBe("2026-05-12");
    expect(readDate("12th May 2026")).toBe("2026-05-12");
  });

  it("falls back to the given year when none is written", () => {
    expect(readDate("Monday 3 June", 2027)).toBe("2027-06-03");
  });

  it("says nothing when there is no date", () => {
    expect(readDate("Crew call")).toBeNull();
  });
});

describe("parseSchedule", () => {
  it("reads a plain list", () => {
    const lines = parseSchedule(`07:00 Crew call
07:30 Breakfast
08:00 First setup
13:00 Lunch
18:00 Wrap`);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatchObject({ time: "07:00", item: "Crew call" });
    expect(lines[4]).toMatchObject({ time: "18:00", item: "Wrap" });
  });

  it("strips the dashes and bullets people separate a time with", () => {
    const lines = parseSchedule(`07:00 - Crew call
• 07:30 — Breakfast
08:00: First setup`);
    expect(lines.map((l) => l.item)).toEqual(["Crew call", "Breakfast", "First setup"]);
  });

  it("keeps an item with no time rather than dropping it", () => {
    const lines = parseSchedule(`07:00 Crew call
Drone shots if the wind drops`);
    expect(lines[1]).toMatchObject({ time: null, item: "Drone shots if the wind drops" });
  });

  it("reads a time written after what happens", () => {
    const lines = parseSchedule("Lunch 13:00");
    expect(lines[0]).toMatchObject({ time: "13:00", item: "Lunch" });
  });

  it("splits a pasted table into item and notes", () => {
    const lines = parseSchedule("07:00\tCrew call\tUnit base, Curtain Road");
    expect(lines[0]).toMatchObject({
      time: "07:00",
      item: "Crew call",
      notes: "Unit base, Curtain Road",
    });
  });

  it("drops the column headings off a pasted table", () => {
    const lines = parseSchedule(`Time\tItem\tNotes
07:00\tCrew call\tUnit base`);
    expect(lines).toHaveLength(1);
    expect(lines[0].item).toBe("Crew call");
  });

  it("carries a day heading down onto the lines under it", () => {
    const lines = parseSchedule(`Day 1 — Monday 12 May 2026
07:00 Crew call
18:00 Wrap

Day 2 — Tuesday 13 May 2026
08:00 Crew call`);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ dayNumber: 1, date: "2026-05-12" });
    expect(lines[1]).toMatchObject({ dayNumber: 1 });
    expect(lines[2]).toMatchObject({ dayNumber: 2, date: "2026-05-13", item: "Crew call" });
  });

  it("does not mistake a line that starts with a weekday for a heading", () => {
    const lines = parseSchedule("Monday 07:00 Crew call");
    expect(lines).toHaveLength(1);
    expect(lines[0].dayHeading).toBeNull();
  });

  it("ignores blank lines", () => {
    expect(parseSchedule("\n\n07:00 Crew call\n\n\n")).toHaveLength(1);
  });

  it("reads a comma-separated export without eating the commas in a note", () => {
    const lines = parseSchedule("07:00  Crew call   Unit base, Curtain Road, London");
    expect(lines[0]).toMatchObject({
      time: "07:00",
      item: "Crew call",
      notes: "Unit base, Curtain Road, London",
    });
  });

  it("finds nothing in an empty paste", () => {
    expect(parseSchedule("   \n  ")).toEqual([]);
  });
});

describe("matchDay", () => {
  const days = [
    { _id: "d1", date: "2026-05-12" },
    { _id: "d2", date: "2026-05-13" },
  ];
  const line = (over: Partial<ParsedScheduleLine>): ParsedScheduleLine => ({
    time: null,
    item: "Crew call",
    notes: null,
    dayHeading: null,
    date: null,
    dayNumber: null,
    ...over,
  });

  it("matches a named date to the shoot day on it", () => {
    expect(matchDay(line({ date: "2026-05-13" }), days)?._id).toBe("d2");
  });

  it("matches a counted day to its position in date order", () => {
    expect(matchDay(line({ dayNumber: 2 }), days)?._id).toBe("d2");
  });

  it("prefers the date when a heading gives both", () => {
    expect(matchDay(line({ dayNumber: 1, date: "2026-05-13" }), days)?._id).toBe("d2");
  });

  it("says nothing when the date is not a shoot day and nothing counts", () => {
    expect(matchDay(line({ date: "2026-06-01" }), days)).toBeNull();
    expect(matchDay(line({ dayNumber: 7 }), days)).toBeNull();
    expect(matchDay(line({}), days)).toBeNull();
  });
});

describe("a schedule pasted a column at a time", () => {
  it("keeps a time that arrived on its own line", () => {
    // Copying a table out of a PDF gives this: the time column, then the
    // item column, each cell on its own line.
    const lines = parseSchedule(`07:00
Crew call
07:30
Breakfast
13:00
Lunch`);
    expect(lines.map((l) => `${l.time} ${l.item}`)).toEqual([
      "07:00 Crew call",
      "07:30 Breakfast",
      "13:00 Lunch",
    ]);
  });

  it("does not carry a time across a day heading", () => {
    const lines = parseSchedule(`18:00
Day 2 — Tuesday 13 May
Crew call`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ time: null, item: "Crew call", dayNumber: 2 });
  });

  it("does not steal a time from a line that has its own", () => {
    const lines = parseSchedule(`07:00
08:00 First setup`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ time: "08:00", item: "First setup" });
  });

  it("reads a dash in front of the time", () => {
    expect(parseSchedule("- 07:00 Crew call")[0]).toMatchObject({
      time: "07:00",
      item: "Crew call",
    });
    expect(parseSchedule("– 13:00 Lunch")[0]).toMatchObject({ time: "13:00", item: "Lunch" });
  });
});
