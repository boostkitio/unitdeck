/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { callSheetEmail } from "./lib/email";
import type { CallSheetData } from "./lib/callSheetData";

const data: CallSheetData = {
  title: "Brand film",
  date: "2026-06-18",
  generalCallTime: "08:00",
  productionCompany: "Boostkit",
  locations: [
    { id: "loc-1", name: "Studio 1", address: "1 High St, Tunbridge Wells" },
  ],
  schedule: [],
  crew: [],
  contacts: [],
};

describe("callSheetEmail", () => {
  test("first send subject and personalised body", () => {
    const { subject, html } = callSheetEmail({
      data,
      recipientName: "Sam Sound",
      recipientCallTime: "07:30",
      setModeUrl: "https://example.test/s/tok123",
      isUpdate: false,
    });
    expect(subject).toBe("Call sheet: Brand film – Thursday, 18 June 2026");
    expect(html).toContain("Sam Sound");
    expect(html).toContain("07:30");
    expect(html).toContain('href="https://example.test/s/tok123"');
    expect(html).toContain("Studio 1");
  });

  test("update send is labelled as updated", () => {
    const { subject, html } = callSheetEmail({
      data,
      recipientName: "Sam",
      recipientCallTime: "07:30",
      setModeUrl: "https://example.test/s/tok123",
      isUpdate: true,
    });
    expect(subject).toBe("Updated call sheet: Brand film – Thursday, 18 June 2026");
    expect(html).toContain("updated");
  });

  test("escapes HTML in user-supplied fields", () => {
    const { html } = callSheetEmail({
      data: { ...data, title: '<script>alert("x")</script>' },
      recipientName: "<b>Sam</b>",
      recipientCallTime: "07:30",
      setModeUrl: "https://example.test/s/tok123",
      isUpdate: false,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Sam</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});
