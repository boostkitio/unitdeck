/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { groupEquipmentBySupplier, callStrip, rowCallTime, scheduledCall } from "./format";

test("groups equipment by supplier in first-seen order", () => {
  const groups = groupEquipmentBySupplier([
    { id: "1", supplier: "Klaxon", item: "FX9" },
    { id: "2", supplier: "Michael", item: "Boom" },
    { id: "3", supplier: "Klaxon", item: "Slider" },
    { id: "4", item: "Sandbags" },
  ]);
  expect(groups.map((g) => g.supplier)).toEqual(["Klaxon", "Michael", null]);
  expect(groups[0].items.map((i) => i.item)).toEqual(["FX9", "Slider"]);
  expect(groups[2].items[0].item).toBe("Sandbags");
});

test("callStrip falls back to the general call time when no tiered times", () => {
  expect(
    callStrip({ callTimes: undefined, generalCallTime: "08:00", schedule: [] }),
  ).toEqual([{ id: "general", label: "General call", time: "08:00" }]);
  const tiered = [{ id: "c", label: "Crew call", time: "07:45" }];
  expect(callStrip({ callTimes: tiered, generalCallTime: "08:00", schedule: [] })).toEqual(
    tiered,
  );
});

const block = (start: string, title: string) => ({ id: start, start, title });

test("the schedule is what the general call follows", () => {
  // The running order is what the day does, and what gets revised in the
  // morning; the crew panel is the one left behind.
  const data = {
    generalCallTime: "07:00",
    schedule: [block("06:30", "Crew call"), block("07:30", "Breakfast")],
  };
  expect(scheduledCall(data)).toBe("06:30");
  expect(callStrip({ ...data, callTimes: [{ id: "c", label: "Crew call", time: "07:00" }] })).toEqual([
    { id: "c", label: "Crew call", time: "06:30" },
  ]);
});

test("a call named in the schedule beats merely the first timed line", () => {
  expect(
    scheduledCall({
      generalCallTime: "09:00",
      schedule: [block("05:00", "Rigging"), block("07:00", "Crew call")],
    }),
  ).toBe("07:00");
});

test("with nothing named, the first timed line is the call", () => {
  expect(
    scheduledCall({
      generalCallTime: "09:00",
      schedule: [block("06:45", "Unit base opens"), block("08:00", "First setup")],
    }),
  ).toBe("06:45");
});

test("an empty schedule leaves the stored call alone", () => {
  expect(scheduledCall({ generalCallTime: "08:00", schedule: [] })).toBe("08:00");
  expect(
    scheduledCall({ generalCallTime: "08:00", schedule: [{ id: "x", start: "", title: "TBC" }] }),
  ).toBe("08:00");
});

test("a separate call keeps its own time", () => {
  // Talent called later than the crew is an arrangement, not a stale value.
  const data = {
    generalCallTime: "07:00",
    schedule: [block("06:30", "Crew call")],
    callTimes: [
      { id: "c", label: "Crew call", time: "07:00" },
      { id: "t", label: "Talent call", time: "09:00" },
    ],
  };
  expect(callStrip(data).map((c) => c.time)).toEqual(["06:30", "09:00"]);
});

test("a person on the general call moves with it, one with their own does not", () => {
  const data = {
    generalCallTime: "07:00",
    schedule: [block("06:30", "Crew call")],
  };
  expect(rowCallTime(data, "07:00")).toBe("06:30");
  expect(rowCallTime(data, "09:00")).toBe("09:00");
  expect(rowCallTime(data, undefined)).toBeUndefined();
});
