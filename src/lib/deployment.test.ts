import { describe, expect, test } from "vitest";
import { devBanner } from "./deployment";

const PRODUCTION = "https://groovy-anaconda-410.convex.cloud";
const DEV = "https://opulent-peacock-325.convex.cloud";

describe("devBanner", () => {
  test("says nothing on the production deployment", () => {
    // The one deployment holding real productions. Anything else is a copy.
    expect(devBanner(PRODUCTION)).toBeNull();
  });

  test("warns on the dev deployment, and names it", () => {
    expect(devBanner(DEV)).toEqual({ deployment: "opulent-peacock-325" });
  });

  test("warns on a deployment it has never heard of", () => {
    // A preview build, a colleague's own deployment, a restored copy: none of
    // them are the live one, and none of them should look like it.
    expect(devBanner("https://spry-marmoset-77.convex.cloud")).toEqual({
      deployment: "spry-marmoset-77",
    });
  });

  test("still warns when the Convex URL is missing or unparseable", () => {
    // Not knowing which deployment this is, is a reason to warn, not to go quiet.
    expect(devBanner(undefined)).toEqual({ deployment: "unknown deployment" });
    expect(devBanner("not a url")).toEqual({ deployment: "unknown deployment" });
  });

  test("is not fooled by a host that merely mentions production", () => {
    expect(devBanner("https://groovy-anaconda-410.evil.example.com")).not.toBeNull();
    expect(devBanner("https://groovy-anaconda-410-staging.convex.cloud")).not.toBeNull();
  });
});
