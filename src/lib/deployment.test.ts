import { describe, expect, test } from "vitest";
import { devBanner } from "./deployment";

const DEV_URL = "https://opulent-peacock-325.convex.cloud";

describe("devBanner", () => {
  test("says nothing when the app has been declared production", () => {
    expect(devBanner(DEV_URL, "production")).toBeNull();
  });

  test("warns when nothing has declared the environment", () => {
    // The common case, and the one that has to be right: an unset variable is
    // dev, because that is what every machine and every preview build is until
    // somebody says otherwise.
    expect(devBanner(DEV_URL, undefined)).toEqual({ deployment: "opulent-peacock-325" });
  });

  test("warns when the declared environment is not exactly production", () => {
    // Fails loud: a typo puts a red bar in front of a real user, which somebody
    // reports within the hour. The opposite mistake hides the bar in dev, and
    // nobody notices until data is in the wrong place.
    expect(devBanner(DEV_URL, "prod")).not.toBeNull();
    expect(devBanner(DEV_URL, "Production")).not.toBeNull();
    expect(devBanner(DEV_URL, "")).not.toBeNull();
  });

  test("names the deployment so it is clear which data is on screen", () => {
    expect(devBanner("https://terrific-badger-42.convex.cloud", undefined)).toEqual({
      deployment: "terrific-badger-42",
    });
  });

  test("still warns when the Convex URL is missing or unparseable", () => {
    // No URL is not a reason to go quiet: it means less is known, not more.
    expect(devBanner(undefined, undefined)).toEqual({ deployment: "unknown deployment" });
    expect(devBanner("not a url", undefined)).toEqual({ deployment: "unknown deployment" });
  });

  test("a missing Convex URL does not override an explicit production", () => {
    expect(devBanner(undefined, "production")).toBeNull();
  });
});
