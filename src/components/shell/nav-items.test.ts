import { describe, it, expect } from "vitest";
import { isActive, MORE_ITEMS, NAV_ITEMS } from "./nav-items";

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

  it("matches the settings section and its nested routes", () => {
    expect(isActive("/settings", "/settings")).toBe(true);
    expect(isActive("/settings/anything", "/settings")).toBe(true);
    expect(isActive("/people", "/settings")).toBe(false);
  });
});

describe("NAV_ITEMS", () => {
  it("includes an Equipment entry pointing at /equipment", () => {
    expect(NAV_ITEMS).toContainEqual(
      expect.objectContaining({ href: "/equipment", label: "Equipment" }),
    );
  });

  it("puts Equipment in the More sheet, not the primary tabs", () => {
    expect(MORE_ITEMS).toContainEqual(
      expect.objectContaining({ href: "/equipment", label: "Equipment" }),
    );
  });

  it("includes a Settings entry pointing at /settings", () => {
    expect(NAV_ITEMS).toContainEqual(expect.objectContaining({ href: "/settings", label: "Settings" }));
  });

  it("puts Settings in the More sheet, not the primary tabs", () => {
    expect(MORE_ITEMS).toContainEqual(expect.objectContaining({ href: "/settings", label: "Settings" }));
  });
});
