import { describe, it, expect } from "vitest";
import {
  LEGACY_STATUSES,
  PROJECT_STATUSES,
  needsAttention,
  normaliseStatus,
  statusBadgeClass,
  statusLabel,
} from "./project-status";

describe("normaliseStatus", () => {
  it("passes current statuses through", () => {
    for (const s of PROJECT_STATUSES) {
      expect(normaliseStatus(s.value)).toBe(s.value);
    }
  });

  it("maps every legacy status onto a current one", () => {
    for (const legacy of LEGACY_STATUSES) {
      expect(PROJECT_STATUSES.map((s) => s.value)).toContain(normaliseStatus(legacy));
    }
  });

  it("maps the old pipeline onto the booking model", () => {
    expect(normaliseStatus("brief")).toBe("not_booked");
    expect(normaliseStatus("pre_production")).toBe("pencilled");
    expect(normaliseStatus("shooting")).toBe("confirmed");
    expect(normaliseStatus("delivered")).toBe("confirmed");
  });

  it("falls back for an unknown value rather than throwing", () => {
    expect(normaliseStatus("mystery")).toBe("not_booked");
  });
});

describe("statusLabel", () => {
  it("labels current and legacy values", () => {
    expect(statusLabel("pencilled")).toBe("Pencilled");
    expect(statusLabel("pre_production")).toBe("Pencilled");
  });

  it("returns an unknown value unchanged", () => {
    expect(statusLabel("mystery")).toBe("Not booked");
  });
});

describe("statusBadgeClass", () => {
  it("gives every status a badge with a background", () => {
    for (const s of PROJECT_STATUSES) {
      expect(statusBadgeClass(s.value)).toMatch(/bg-/);
    }
    for (const legacy of LEGACY_STATUSES) {
      expect(statusBadgeClass(legacy)).toMatch(/bg-/);
    }
  });
});

describe("needsAttention", () => {
  it("covers anything not yet confirmed, including legacy equivalents", () => {
    expect(needsAttention("not_booked")).toBe(true);
    expect(needsAttention("pencilled")).toBe(true);
    expect(needsAttention("brief")).toBe(true);
    expect(needsAttention("pre_production")).toBe(true);
  });

  it("excludes confirmed work", () => {
    expect(needsAttention("confirmed")).toBe(false);
    expect(needsAttention("shooting")).toBe(false);
    expect(needsAttention("delivered")).toBe(false);
  });
});
