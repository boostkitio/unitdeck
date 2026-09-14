import { describe, expect, it } from "vitest";
import { mapEmbedSrc, mapLink, osmTiles } from "./maps";

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

describe("osmTiles", () => {
  it("puts the point in the middle of the box", () => {
    // Null Island sits on the corner of four tiles at every zoom.
    const tiles = osmTiles(0, 0, 1, 100, 100);
    expect(tiles.map((t) => t.url).sort()).toEqual([
      "https://tile.openstreetmap.org/1/0/0.png",
      "https://tile.openstreetmap.org/1/0/1.png",
      "https://tile.openstreetmap.org/1/1/0.png",
      "https://tile.openstreetmap.org/1/1/1.png",
    ]);
    const topLeft = tiles.find((t) => t.url.endsWith("/1/0/0.png"))!;
    expect(topLeft).toMatchObject({ left: -206, top: -206 });
  });

  it("covers the whole box with no gaps", () => {
    const width = 348;
    const height = 256;
    const tiles = osmTiles(51.1324, 0.2637, 16, width, height);
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
      [width / 2, height / 2],
    ]) {
      const covering = tiles.filter(
        (t) => x >= t.left && x < t.left + 256 && y >= t.top && y < t.top + 256
      );
      expect(covering).toHaveLength(1);
    }
  });

  it("wraps across the antimeridian", () => {
    const urls = osmTiles(0, 179.99, 2, 256, 64).map((t) => t.url);
    expect(urls.some((u) => u.includes("/2/0/"))).toBe(true);
    expect(urls.some((u) => u.includes("/2/3/"))).toBe(true);
  });
});
