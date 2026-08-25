import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { pdfToText } from "./pdf-text";
import { parseSchedule } from "./parse-schedule";

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
