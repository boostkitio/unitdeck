/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { talentReleaseInviteEmail, signedCopyEmail, sendEmail } from "./email";

test("sendEmail returns ok with the provider id on success", async () => {
  // vitest.setup.ts stubs api.resend.com with a 200 { id: "email_test_stub" }
  const result = await sendEmail({
    apiKey: "resend-test-key",
    to: ["someone@example.test"],
    subject: "Test",
    html: "<p>Test</p>",
  });
  expect(result).toEqual({ ok: true, id: "email_test_stub" });
});

test("sendEmail returns a failure result instead of throwing", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("boom", { status: 500 })) as typeof fetch;
  try {
    const result = await sendEmail({
      apiKey: "resend-test-key",
      to: ["someone@example.test"],
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Resend 500");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("invite email includes the sign link and production, and escapes html", () => {
  const { subject, html } = talentReleaseInviteEmail({
    talentName: "Claire <O'Brien>",
    productionTitle: "Barclays",
    productionCompany: "Klaxon",
    signUrl: "https://unitdeck.app/sign/tok_abc",
  });
  expect(subject).toContain("Barclays");
  expect(html).toContain("https://unitdeck.app/sign/tok_abc");
  expect(html).toContain("Claire &lt;O&#39;Brien&gt;");
  expect(html).not.toContain("<O'Brien>");
});

test("signed copy email links the document and names the production", () => {
  const { subject, html } = signedCopyEmail({ talentName: "Claire", productionTitle: "Barclays", productionCompany: "Klaxon", viewUrl: "https://unitdeck.app/sign/tok" });
  expect(subject.toLowerCase()).toContain("signed");
  expect(html).toContain("https://unitdeck.app/sign/tok");
  expect(html).toContain("Barclays");
});
