/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pre_production",
    });
    const person = await ctx.db.insert("people", {
      orgId: org,
      name: "Sam Reed",
      role: "Sound recordist",
      email: "sam@example.test",
      phone: "07700 900000",
    });
    return { org, project, person };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("crew list resolves contact details from the person record", async () => {
  const { ids, asA } = await setup();

  await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });

  const crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew).toHaveLength(1);
  expect(crew[0]).toMatchObject({
    name: "Sam Reed",
    // No override was given, so the person's usual role shows.
    role: "Sound recordist",
    email: "sam@example.test",
    phone: "07700 900000",
  });
});

test("a project role overrides the person's usual role, and clearing it falls back", async () => {
  const { ids, asA } = await setup();

  const bookingId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
    role: "Boom op",
  });

  let crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew[0].role).toBe("Boom op");

  await asA.mutation(api.projectCrew.update, { id: bookingId, role: null });
  crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew[0].role).toBe("Sound recordist");
});

test("the same person cannot be booked onto a project twice", async () => {
  const { ids, asA } = await setup();

  await asA.mutation(api.projectCrew.add, { projectId: ids.project, personId: ids.person });
  await expect(
    asA.mutation(api.projectCrew.add, { projectId: ids.project, personId: ids.person }),
  ).rejects.toThrow(/already on this project/);
});

test("removing a booking leaves the person in the contact book", async () => {
  const { ids, asA } = await setup();

  const bookingId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });
  await asA.mutation(api.projectCrew.remove, { id: bookingId });

  expect(await asA.query(api.projectCrew.listForProject, { projectId: ids.project })).toEqual([]);
  const people = await asA.query(api.people.list, {});
  expect(people.map((p) => p.name)).toContain("Sam Reed");
});

test("another org cannot see or touch a project's crew", async () => {
  const { t, ids, asA } = await setup();
  const bookingId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  // The project belongs to Org A, so Org B sees nothing rather than a leak.
  expect(await asB.query(api.projectCrew.listForProject, { projectId: ids.project })).toEqual([]);
  await expect(asB.mutation(api.projectCrew.remove, { id: bookingId })).rejects.toThrow();
});

test("a role can be added with nobody in it, then filled", async () => {
  const { ids, asA } = await setup();

  const roleId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    role: "Gaffer",
  });

  let crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew).toHaveLength(1);
  expect(crew[0]).toMatchObject({
    personId: null,
    name: null,
    role: "Gaffer",
    email: null,
    phone: null,
  });

  await asA.mutation(api.projectCrew.assign, { id: roleId, personId: ids.person });

  crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew).toHaveLength(1);
  // The role survives the booking — it is what the slot was created for.
  expect(crew[0]).toMatchObject({ name: "Sam Reed", role: "Gaffer", email: "sam@example.test" });
});

test("a role with nobody in it needs a name", async () => {
  const { ids, asA } = await setup();
  await expect(
    asA.mutation(api.projectCrew.add, { projectId: ids.project, role: "   " }),
  ).rejects.toThrow(/Name the role/);
  await expect(
    asA.mutation(api.projectCrew.add, { projectId: ids.project }),
  ).rejects.toThrow(/Name the role/);
});

test("filling a role cannot double-book someone already on the project", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projectCrew.add, { projectId: ids.project, personId: ids.person });
  const roleId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    role: "Gaffer",
  });

  await expect(
    asA.mutation(api.projectCrew.assign, { id: roleId, personId: ids.person }),
  ).rejects.toThrow(/already on this project/);
});

test("unfilled roles sort above booked crew", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projectCrew.add, { projectId: ids.project, personId: ids.person });
  await asA.mutation(api.projectCrew.add, { projectId: ids.project, role: "Gaffer" });

  const crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew.map((m) => m.name)).toEqual([null, "Sam Reed"]);
});
