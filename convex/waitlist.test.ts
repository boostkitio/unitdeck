/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("join stores the email once, case-insensitively", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.waitlist.join, { email: "a@b.co", source: "home", website: "" });
  await t.mutation(api.waitlist.join, { email: "A@B.CO", source: "compare", website: "" });
  const rows = await t.run(async (ctx) => ctx.db.query("waitlist").take(10));
  expect(rows).toHaveLength(1);
  expect(rows[0].email).toBe("a@b.co");
});

test("honeypot submissions are silently dropped", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.waitlist.join, {
    email: "bot@spam.test",
    source: "home",
    website: "https://spam.example",
  });
  const rows = await t.run(async (ctx) => ctx.db.query("waitlist").take(10));
  expect(rows).toHaveLength(0);
});

test("invalid emails are rejected", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.waitlist.join, { email: "not-an-email", source: "home", website: "" })
  ).rejects.toThrow("valid email");
});
