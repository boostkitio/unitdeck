/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { talentReleaseInviteEmail, signedCopyEmail } from "./email";

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
