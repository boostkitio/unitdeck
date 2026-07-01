/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { talentReleaseInviteEmail } from "./email";

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
