import { describe, it, expect } from "vitest";
import { isActive } from "./nav-items";

describe("isActive", () => {
  it("matches the dashboard only on an exact path", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
    expect(isActive("/dashboard/anything", "/dashboard")).toBe(false);
  });

  it("matches a section and its nested routes", () => {
    expect(isActive("/projects", "/projects")).toBe(true);
    expect(isActive("/projects/abc123", "/projects")).toBe(true);
  });

  it("does not match a different section", () => {
    expect(isActive("/people", "/projects")).toBe(false);
  });
});
