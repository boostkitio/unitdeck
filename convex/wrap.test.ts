/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "Brand film",
      status: "shooting",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: "2026-06-18",
      locationIds: [],
    });
    await ctx.db.insert("recipients", {
      orgId: orgA,
      shootDayId: dayA,
      name: "Sam",
      role: "Sound",
      email: "sam@example.test",
      callTime: "07:30",
      token: "tok_sam",
      status: "confirmed",
      confirmedAt: 1,
      checkInAt: 2,
      safetyAckAt: 3,
    });
    await ctx.db.insert("recipients", {
      orgId: orgA,
      shootDayId: dayA,
      name: "Alex",
      role: "DP",
      email: "alex@example.test",
      callTime: "07:00",
      token: "tok_alex",
      status: "declined",
    });
    return { orgA, projectA, dayA };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("report returns attendance with check-in and ack times", async () => {
  const { asA, ids } = await setup();
  const report = await asA.query(api.wrap.report, { shootDayId: ids.dayA });
  expect(report.projectName).toBe("Brand film");
  expect(report.attendance).toHaveLength(2);
  const sam = report.attendance.find((a) => a.name === "Sam")!;
  expect(sam.checkInAt).toBe(2);
  expect(sam.safetyAckAt).toBe(3);
  const alex = report.attendance.find((a) => a.name === "Alex")!;
  expect(alex.status).toBe("declined");
  expect(alex.checkInAt).toBeNull();
});

test("wrap notes save and round-trip", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.wrap.saveNotes, {
    shootDayId: ids.dayA,
    notes: "Overran by 20 minutes. Pickup needed for exterior b-roll.",
  });
  const report = await asA.query(api.wrap.report, { shootDayId: ids.dayA });
  expect(report.wrapNotes).toContain("Overran");
});

test("cross-org access is rejected", async () => {
  const { t, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  await expect(asB.query(api.wrap.report, { shootDayId: ids.dayA })).rejects.toThrow(
    "Shoot day not found"
  );
});
