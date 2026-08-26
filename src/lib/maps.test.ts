import { describe, expect, it } from "vitest";
import { mapEmbedSrc, mapLink } from "./maps";

describe("mapEmbedSrc", () => {
  it("uses the supported embed endpoint when there is a key", () => {
    const src = mapEmbedSrc("Salomons Estate, Tunbridge Wells", "test-key");
    expect(src).toBe(
      "https://www.google.com/maps/embed/v1/place?key=test-key&q=Salomons%20Estate%2C%20Tunbridge%20Wells"
    );
  });

  // The old keyless fallback pointed at google.com/maps?output=embed, which is
  // undocumented and unsupported. Rendering nothing lets the caller show
  // something honest instead of an iframe that may stop working without notice.
  it("has no embed to show without a key", () => {
    expect(mapEmbedSrc("Salomons Estate", undefined)).toBeNull();
  });

  it("has no embed to show for a blank query", () => {
    expect(mapEmbedSrc("   ", "test-key")).toBeNull();
  });
});

describe("mapLink", () => {
  it("builds a search link anyone can open", () => {
    expect(mapLink("Tunbridge Wells")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Tunbridge%20Wells"
    );
  });
});
