/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { groupEquipmentBySupplier, callStrip } from "./format";

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
  expect(callStrip({ callTimes: undefined, generalCallTime: "08:00" })).toEqual([
    { id: "general", label: "General call", time: "08:00" },
  ]);
  const tiered = [{ id: "c", label: "Crew call", time: "07:45" }];
  expect(callStrip({ callTimes: tiered, generalCallTime: "08:00" })).toBe(tiered);
});
