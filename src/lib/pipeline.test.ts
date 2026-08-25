import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { pdfToText } from "./pdf-text";
import { findScheduleRegion, parseSchedule } from "./parse-schedule";

/**
 * The whole way through, on a real file: a PDF laid out as a table comes back
 * as the rows a producer would have typed. This is the claim the feature
 * makes, so it is worth testing end to end rather than in halves.
 */
test("a schedule PDF becomes schedule lines", async () => {
  const path = fileURLToPath(new URL("./__fixtures__/schedule.pdf", import.meta.url));
  const lines = parseSchedule(await pdfToText(new Uint8Array(readFileSync(path))));

  const timed = lines.filter((line) => line.time !== null);
  expect(timed.map((line) => `${line.time} ${line.item}`)).toEqual([
    "07:00 Crew call",
    "07:30 Breakfast",
    "08:00 First setup",
    "13:00 Lunch",
    "18:00 Wrap",
  ]);
  expect(timed[0].notes).toBe("Unit base, Curtain Road");
  expect(timed[3].notes).toBe("On location");
  // The day heading was read off the page rather than left as an item.
  expect(timed[0].dayNumber).toBe(1);
  expect(timed[0].date).toBe("2026-05-12");
});

/**
 * The case that failed: a PDF that is mostly other things.
 *
 * A call sheet's crew table carries a call time against every name, so the
 * document is full of times that are not the running order. Importing the
 * whole file gave a schedule of crew names and kit.
 */
test("a full call sheet PDF yields only its running order", async () => {
  const path = fileURLToPath(new URL("./__fixtures__/call-sheet.pdf", import.meta.url));
  const text = await pdfToText(new Uint8Array(readFileSync(path)));

  // Everything is in there to begin with.
  expect(text).toContain("Sam Reed");
  expect(text).toContain("Techno crane");

  const region = findScheduleRegion(text);
  expect(region).not.toBeNull();
  expect(region!.namedByHeading).toBe(true);

  const lines = parseSchedule(region!.text);
  expect(lines.map((l) => `${l.time} ${l.item}`)).toEqual([
    "07:00 Crew call",
    "07:30 Breakfast",
    "08:00 First setup",
    "10:30 Client arrives",
    "11:00 Second setup",
    "13:00 Lunch",
    "14:00 Interviews",
    "16:30 Pick-ups",
    "18:00 Wrap",
  ]);
  expect(lines[0].notes).toBe("Unit base, Tree Lane");

  // None of the crew, talent, client or kit came along for the ride.
  const everything = lines.map((l) => `${l.item} ${l.notes ?? ""}`).join(" ");
  for (const stray of ["Sam Reed", "Jo Patel", "Ali Khan", "FX9", "Techno crane"]) {
    expect(everything).not.toContain(stray);
  }
});
