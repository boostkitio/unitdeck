import { describe, expect, test } from "vitest";
import { displayName, joinName } from "./personName";

describe("joinName", () => {
  test("puts a first and last name together", () => {
    expect(joinName({ firstName: "Matt", lastName: "West" })) .toBe("Matt West");
  });

  test("copes with only one half", () => {
    expect(joinName({ firstName: "Matt" })).toBe("Matt");
    expect(joinName({ lastName: "West" })).toBe("West");
  });

  test("treats whitespace as nothing said", () => {
    expect(joinName({ firstName: "  ", lastName: "  " })).toBe("");
    expect(joinName({ firstName: " Matt ", lastName: "  " })).toBe("Matt");
  });

  test("copes with null and undefined", () => {
    expect(joinName(null)).toBe("");
    expect(joinName(undefined)).toBe("");
    expect(joinName({ firstName: null, lastName: null })).toBe("");
  });
});

describe("displayName", () => {
  test("the name you chose beats the one the login carries", () => {
    expect(
      displayName({
        chosen: { firstName: "Matt", lastName: "West" },
        fromAuth: { firstName: "Matthew", lastName: "West" },
        email: "matt@boostkit.io",
      })
    ).toBe("Matt West");
  });

  test("falls back to the login's name when nothing was chosen here", () => {
    expect(
      displayName({
        chosen: null,
        fromAuth: { firstName: "Matthew", lastName: "West" },
        email: "matt@boostkit.io",
      })
    ).toBe("Matthew West");
  });

  // The case that sent us here: Clerk refuses to hold a name unless the
  // instance has Name enabled, so fromAuth is empty for everyone.
  test("a name set here shows even when the login has none at all", () => {
    expect(
      displayName({
        chosen: { firstName: "Matt", lastName: "West" },
        fromAuth: { firstName: null, lastName: null },
        email: "matt@boostkit.io",
      })
    ).toBe("Matt West");
  });

  test("falls back to the email address when nobody has a name", () => {
    expect(
      displayName({ chosen: null, fromAuth: null, email: "matt@boostkit.io" })
    ).toBe("matt@boostkit.io");
  });

  test("a cleared name falls through rather than showing as blank", () => {
    expect(
      displayName({
        chosen: { firstName: "", lastName: "" },
        fromAuth: null,
        email: "matt@boostkit.io",
      })
    ).toBe("matt@boostkit.io");
  });

  test("gives up gracefully when there is not even an email", () => {
    expect(displayName({})).toBe("A member");
    expect(displayName({ fallback: "Someone who has since left" })).toBe(
      "Someone who has since left"
    );
  });
});
