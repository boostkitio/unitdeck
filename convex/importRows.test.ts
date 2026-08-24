/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("importing clients creates rows and fills every column", async () => {
  const { asA } = await setup();

  const result = await asA.mutation(api.clients.importRows, {
    rows: [
      {
        name: "Acme Films",
        contactName: "Sam Reed",
        phone: "07700 900000",
        email: "sam@acme.test",
        notes: "Retainer",
      },
    ],
  });

  expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
  const clients = await asA.query(api.clients.list, {});
  expect(clients[0]).toMatchObject({
    name: "Acme Films",
    contactName: "Sam Reed",
    phone: "07700 900000",
    email: "sam@acme.test",
    notes: "Retainer",
  });
});

test("re-importing the same company updates it instead of duplicating", async () => {
  const { asA } = await setup();
  await asA.mutation(api.clients.importRows, {
    rows: [{ name: "Acme Films", email: "old@acme.test" }],
  });

  // Same company, different case and padding — still the same client.
  const result = await asA.mutation(api.clients.importRows, {
    rows: [{ name: "  acme films  ", email: "new@acme.test" }],
  });

  expect(result).toMatchObject({ created: 0, updated: 1 });
  const clients = await asA.query(api.clients.list, {});
  expect(clients).toHaveLength(1);
  expect(clients[0].email).toBe("new@acme.test");
});

test("duplicate rows inside one file collapse to a single client", async () => {
  const { asA } = await setup();

  const result = await asA.mutation(api.clients.importRows, {
    rows: [
      { name: "Acme Films", email: "first@acme.test" },
      { name: "Acme Films", email: "second@acme.test" },
    ],
  });

  expect(result).toMatchObject({ created: 1, updated: 1 });
  expect(await asA.query(api.clients.list, {})).toHaveLength(1);
});

test("a row with no company is skipped rather than failing the batch", async () => {
  const { asA } = await setup();

  const result = await asA.mutation(api.clients.importRows, {
    rows: [{ name: "   " }, { name: "Acme Films" }],
  });

  expect(result).toMatchObject({ created: 1, skipped: 1 });
  expect(await asA.query(api.clients.list, {})).toHaveLength(1);
});

test("importing people defaults a blank role and keeps it on update", async () => {
  const { asA } = await setup();

  await asA.mutation(api.people.importRows, { rows: [{ name: "Sam Reed" }] });
  let people = await asA.query(api.people.list, {});
  expect(people[0].role).toBe("Crew");

  await asA.mutation(api.people.importRows, {
    rows: [{ name: "Sam Reed", role: "Sound recordist" }],
  });
  people = await asA.query(api.people.list, {});
  expect(people).toHaveLength(1);
  expect(people[0].role).toBe("Sound recordist");

  // A blank role on a later import must not wipe the real one.
  await asA.mutation(api.people.importRows, {
    rows: [{ name: "Sam Reed", phone: "07700 900000" }],
  });
  people = await asA.query(api.people.list, {});
  expect(people[0].role).toBe("Sound recordist");
  expect(people[0].phone).toBe("07700 900000");
});

test("an oversized batch is rejected", async () => {
  const { asA } = await setup();
  const rows = Array.from({ length: 201 }, (_, i) => ({ name: `Client ${i}` }));

  await expect(asA.mutation(api.clients.importRows, { rows })).rejects.toThrow(/at most/);
  expect(await asA.query(api.clients.list, {})).toHaveLength(0);
});

test("an import cannot reach another org's records", async () => {
  const { t, asA } = await setup();
  await asA.mutation(api.clients.importRows, { rows: [{ name: "Acme Films" }] });

  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  // Same company name, different org: a new row, not an update of Org A's.
  const result = await asB.mutation(api.clients.importRows, { rows: [{ name: "Acme Films" }] });
  expect(result).toMatchObject({ created: 1, updated: 0 });
  expect(await asB.query(api.clients.list, {})).toHaveLength(1);
  expect(await asA.query(api.clients.list, {})).toHaveLength(1);
});
