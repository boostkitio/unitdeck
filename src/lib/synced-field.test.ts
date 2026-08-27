import { describe, expect, test } from "vitest";
import { fieldValue, shouldSave, shouldSettle } from "./synced-field";

describe("what the field shows", () => {
  test("your own text while you are typing", () => {
    expect(fieldValue("Brand film v2", "Brand film")).toBe("Brand film v2");
  });

  test("the stored value when you are not", () => {
    expect(fieldValue(null, "Brand film")).toBe("Brand film");
  });

  test("an emptied field is your text, not an absent draft", () => {
    expect(fieldValue("", "Brand film")).toBe("");
  });
});

describe("two people in the same project", () => {
  test("somebody else's change is adopted, not overwritten", () => {
    // The whole bug: my copy says "Brand film", theirs arrives as "Brand film
    // v2". I have typed nothing, so there is no draft and nothing to write —
    // previously this difference alone triggered a save of my stale copy.
    expect(shouldSave(null, "Brand film v2")).toBe(false);
    expect(fieldValue(null, "Brand film v2")).toBe("Brand film v2");
  });

  test("what I have actually typed is written", () => {
    expect(shouldSave("Brand film v3", "Brand film v2")).toBe(true);
  });

  test("clearing a field is an edit like any other", () => {
    expect(shouldSave("", "Brand film")).toBe(true);
  });

  test("a draft matching the store has nothing left to write", () => {
    expect(shouldSave("Brand film", "Brand film")).toBe(false);
  });
});

describe("settling once the save comes back", () => {
  test("the draft is dropped when the store agrees with it", () => {
    expect(shouldSettle("Brand film v3", "Brand film v3")).toBe(true);
  });

  test("it is held until then, so the field does not flick to the old text", () => {
    expect(shouldSettle("Brand film v3", "Brand film v2")).toBe(false);
  });

  test("there is nothing to settle when nothing was typed", () => {
    expect(shouldSettle(null, "Brand film")).toBe(false);
  });
});

describe("holding back a value the server would refuse", () => {
  const notBlank = (value: string) => value.trim().length > 0;

  test("a half-deleted field is not sent", () => {
    expect(shouldSave("", "Brand film", notBlank)).toBe(false);
  });

  test("what replaces it is", () => {
    expect(shouldSave("Promo", "Brand film", notBlank)).toBe(true);
  });
});
