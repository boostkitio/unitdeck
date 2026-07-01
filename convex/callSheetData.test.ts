/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { migrateLegacyContacts } from "./lib/callSheetData";
import type { CallSheetData } from "./lib/callSheetData";

function base(): CallSheetData {
  return {
    title: "T",
    date: "2026-06-09",
    generalCallTime: "08:00",
    productionCompany: "Klaxon",
    locations: [],
    schedule: [],
    crew: [],
    contacts: [],
  };
}

test("moves legacy contacts into a Key contacts section and clears the flat list", () => {
  const data = {
    ...base(),
    contacts: [{ id: "c1", name: "Jo", role: "Producer", phone: "0700" }],
  };
  const out = migrateLegacyContacts(data);
  expect(out.contacts).toEqual([]);
  expect(out.contactSections?.at(-1)?.title).toBe("Key contacts");
  expect(out.contactSections?.at(-1)?.rows[0]).toMatchObject({
    name: "Jo",
    role: "Producer",
    phone: "0700",
  });
});

test("is a no-op when there are no legacy contacts", () => {
  const data = base();
  const out = migrateLegacyContacts(data);
  expect(out).toEqual(data);
});

test("is idempotent (running twice does not duplicate the section)", () => {
  const data = {
    ...base(),
    contacts: [{ id: "c1", name: "Jo", role: "Producer", phone: "0700" }],
  };
  const once = migrateLegacyContacts(data);
  const twice = migrateLegacyContacts(once);
  expect(twice.contactSections).toHaveLength(1);
  expect(twice.contacts).toEqual([]);
});
