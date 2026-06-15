import { describe, it, expect } from "vitest";
import { PROJECT_STATUSES, statusLabel, statusBadgeClass } from "./project-status";

describe("project status", () => {
  it("labels known and unknown values", () => {
    expect(statusLabel("shooting")).toBe("Shooting");
    expect(statusLabel("mystery")).toBe("mystery");
  });

  it("gives every known status a badge class with a background", () => {
    for (const s of PROJECT_STATUSES) {
      expect(statusBadgeClass(s.value)).toMatch(/bg-/);
    }
  });

  it("falls back to a neutral badge for unknown status", () => {
    expect(statusBadgeClass("mystery")).toMatch(/bg-/);
  });
});
