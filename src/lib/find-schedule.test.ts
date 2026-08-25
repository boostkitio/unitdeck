import { describe, expect, it } from "vitest";
import {
  collapseLetterSpacing,
  findScheduleRegion,
  isOtherSectionHeading,
  isScheduleHeading,
} from "./parse-schedule";
import { parseSchedule } from "./parse-schedule";

/** A call sheet: mostly other things, with a running order inside it. */
const CALL_SHEET = `Boostkit for Acme Films
Brand film — Meridian
Call sheet
Tuesday, 12 May 2026
Weather: Light rain, 11–16°C   Sunrise: 05:12   Sunset: 20:34

CREW
Name\tRole\tCall\tPhone
Sam Reed\tDP\t07:00\t07700 900000
Priya Shah\t1st AC\t07:00\t07700 900111
Alex Okafor\tGaffer\t06:30\t07700 900444
Jaz Miller\tSparks\t06:30\t07700 900555

TALENT
Role\tName\tCall
Lead\tJo Patel\t09:00

SCHEDULE
07:00\tCrew call\tUnit base
07:30\tBreakfast
08:00\tFirst setup\tKitchen
13:00\tLunch
18:00\tWrap

EQUIPMENT
Camera\t2 × FX9
Lighting\t3 × Aputure 600d`;

describe("isScheduleHeading", () => {
  it("knows the words a running order is headed with", () => {
    expect(isScheduleHeading("SCHEDULE")).toBe(true);
    expect(isScheduleHeading("Shooting schedule")).toBe(true);
    expect(isScheduleHeading("Running order")).toBe(true);
    expect(isScheduleHeading("Schedule — Day 1")).toBe(true);
  });

  it("is not fooled by a sentence that mentions one", () => {
    expect(isScheduleHeading("We will confirm the schedule once the client signs off")).toBe(
      false,
    );
    expect(isScheduleHeading("Crew")).toBe(false);
  });
});

describe("isOtherSectionHeading", () => {
  it("knows the parts of a document that are not the running order", () => {
    expect(isOtherSectionHeading("CREW")).toBe(true);
    expect(isOtherSectionHeading("Equipment")).toBe(true);
    expect(isOtherSectionHeading("Key contacts")).toBe(true);
  });

  it("does not mistake an item for a heading", () => {
    expect(isOtherSectionHeading("Crew call at unit base on Tree Lane")).toBe(false);
    expect(isOtherSectionHeading("Lunch")).toBe(false);
  });
});

describe("findScheduleRegion", () => {
  it("finds the running order inside a whole call sheet", () => {
    const region = findScheduleRegion(CALL_SHEET);
    expect(region).not.toBeNull();
    expect(region!.namedByHeading).toBe(true);

    const lines = parseSchedule(region!.text);
    expect(lines.map((l) => l.item)).toEqual([
      "Crew call",
      "Breakfast",
      "First setup",
      "Lunch",
      "Wrap",
    ]);
    // The crew table is as full of times as the schedule; the heading is what
    // tells them apart.
    expect(region!.text).not.toContain("Sam Reed");
    expect(region!.text).not.toContain("FX9");
    expect(region!.skipped).toBeGreaterThan(10);
  });

  it("stops at whatever heads the next section", () => {
    const region = findScheduleRegion(CALL_SHEET);
    expect(region!.text).not.toContain("EQUIPMENT");
  });

  it("falls back to the longest run of times when nothing is headed", () => {
    const region = findScheduleRegion(`Some preamble about the shoot
A paragraph nobody needs to import
07:00 Crew call
07:30 Breakfast
08:00 First setup
18:00 Wrap
Signed, the producer`);
    expect(region).not.toBeNull();
    expect(region!.namedByHeading).toBe(false);
    expect(parseSchedule(region!.text).map((l) => l.item)).toEqual([
      "Crew call",
      "Breakfast",
      "First setup",
      "Wrap",
      // The line after the run comes along, being close enough to be an item
      // whose time is not settled.
      "Signed, the producer",
    ]);
  });

  it("keeps a day heading sitting above the first timed line", () => {
    const region = findScheduleRegion(`Notes for the team
Day 2 — Tuesday 13 May 2026
08:00 Crew call
09:00 First setup
18:00 Wrap`);
    expect(region!.text).toContain("Day 2");
    expect(parseSchedule(region!.text)[0].dayNumber).toBe(2);
  });

  it("says nothing when a document has no run of times", () => {
    expect(findScheduleRegion("A treatment with prose and no times at all")).toBeNull();
    // Two stray times is a coincidence, not a schedule.
    expect(findScheduleRegion("Invoice due 30 days\n07:00 something\n18:00 else")).toBeNull();
  });

  it("keeps the whole of a multi-day schedule together", () => {
    const region = findScheduleRegion(`SCHEDULE
Day 1 — Monday 12 May
07:00 Crew call
18:00 Wrap
Day 2 — Tuesday 13 May
08:00 Crew call
19:00 Wrap`);
    const lines = parseSchedule(region!.text);
    expect(lines).toHaveLength(4);
    expect(lines[3].dayNumber).toBe(2);
  });
});

describe("collapseLetterSpacing", () => {
  it("rejoins a heading a designer spread out", () => {
    // This is literally what a PDF stores for a tracked-out heading.
    expect(collapseLetterSpacing("S C H E D U L E")).toBe("SCHEDULE");
    expect(collapseLetterSpacing("E Q U I P M E N T")).toBe("EQUIPMENT");
    // Kerning pairs leave the odd two-letter run behind.
    expect(collapseLetterSpacing("TA L E N T")).toBe("TALENT");
  });

  it("leaves ordinary text alone", () => {
    expect(collapseLetterSpacing("2 x 2K HMI")).toBe("2 x 2K HMI");
    expect(collapseLetterSpacing("3 × Aputure 600d")).toBe("3 × Aputure 600d");
    expect(collapseLetterSpacing("Crew call at unit base")).toBe("Crew call at unit base");
    expect(collapseLetterSpacing("A B")).toBe("A B");
  });

  it("finds a schedule under a letter-spaced heading", () => {
    const region = findScheduleRegion(`C R E W
Sam Reed\tDP\t07:00
S C H E D U L E
07:00 Crew call
07:30 Breakfast
18:00 Wrap`);
    expect(region!.namedByHeading).toBe(true);
    expect(region!.text).not.toContain("Sam Reed");
  });
});
