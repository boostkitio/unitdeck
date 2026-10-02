import { expect, test } from "vitest";
import {
  callSheetHref,
  combinedCallSheetHref,
  dayRef,
  kitListHref,
  projectHref,
  quoteHref,
  quoteViewHref,
  samePath,
  wrapReportHref,
} from "./routes";

test("a production is addressed by its job number, and by its id until it has one", () => {
  expect(projectHref({ _id: "k17abc", jobNumber: "0025" })).toBe("/projects/0025");
  expect(projectHref({ _id: "k17abc", jobNumber: null })).toBe("/projects/k17abc");
  expect(projectHref({ _id: "k17abc", jobNumber: "  " })).toBe("/projects/k17abc");
  // A house scheme with a space or a slash in it still makes one path segment.
  expect(projectHref({ _id: "k17abc", jobNumber: "KLX 42/A" })).toBe("/projects/KLX%2042%2FA");
});

test("a shoot day is addressed by its date", () => {
  const day = { _id: "kh7one", date: "2026-10-05" };
  expect(dayRef(day)).toBe("2026-10-05");
  expect(dayRef(day, [day, { _id: "kh7two", date: "2026-10-06" }])).toBe("2026-10-05");
  expect(callSheetHref("0025", dayRef(day))).toBe("/projects/0025/call-sheets/2026-10-05");
  expect(wrapReportHref("0025", dayRef(day))).toBe("/projects/0025/wrap/2026-10-05");
});

test("two days on one date go by their ids, since the date names neither", () => {
  const day = { _id: "kh7one", date: "2026-10-05" };
  expect(dayRef(day, [day, { _id: "kh7two", date: "2026-10-05" }])).toBe("kh7one");
});

test("the pages under a production hang off its address", () => {
  const project = { _id: "k17abc", jobNumber: "0025" };
  expect(kitListHref(project)).toBe("/projects/0025/kit-list");
  expect(combinedCallSheetHref(project)).toBe("/projects/0025/call-sheets/combined");
});

test("a quote is addressed by its reference", () => {
  expect(quoteHref({ _id: "ns7abc", number: "260915_Rap_2" })).toBe("/quotes/260915_Rap_2");
  expect(quoteViewHref({ _id: "ns7abc", number: "260915_Rap_2" })).toBe("/quotes/260915_Rap_2/view");
  expect(quoteHref({ _id: "ns7abc", number: "" })).toBe("/quotes/ns7abc");
  expect(quoteHref("ns7abc")).toBe("/quotes/ns7abc");
});

test("the same address encoded two ways is still the same address", () => {
  expect(samePath("/projects/KLX%2042", "/projects/KLX 42")).toBe(true);
  expect(samePath("/projects/0025", "/projects/0026")).toBe(false);
  // A stray percent sign is not a reason to throw.
  expect(samePath("/projects/100%", "/projects/100%")).toBe(true);
});
