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

test("crew nobody has arranged come back in the order they were booked", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.projectCrew.add, { projectId: ids.project, personId: ids.person });
  await asA.mutation(api.projectCrew.add, { projectId: ids.project, role: "Gaffer" });

  // Unfilled roles used to be lifted to the top here, which is why arranging
  // the list never held: the read undid it. Booking order is what an
  // unarranged list means now, and dragging is how it changes.
  const crew = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(crew.map((m) => m.name ?? m.role)).toEqual(["Sam Reed", "Gaffer"]);
});

test("talent are booked like crew and kept apart from them", async () => {
  const { ids, asA } = await setup();

  await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
    kind: "talent",
  });
  await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    role: "Gaffer",
    kind: "crew",
  });

  const rows = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(rows.find((r) => r.personId !== null)?.kind).toBe("talent");
  expect(rows.find((r) => r.personId === null)?.kind).toBe("crew");
});

test("a booking made before talent existed reads as crew", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    await ctx.db.insert("projectCrew", {
      orgId: project.orgId,
      projectId: ids.project,
      personId: ids.person,
    });
  });

  const rows = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(rows[0].kind).toBe("crew");
});

test("a booking can be moved between crew and talent", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });

  await asA.mutation(api.projectCrew.update, { id, kind: "talent" });

  const rows = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(rows[0].kind).toBe("talent");
});

test("the arranged order is what the list comes back in", async () => {
  const { t, ids, asA } = await setup();
  const people = await t.run(async (ctx) => {
    const project = (await ctx.db.get(ids.project))!;
    const made: string[] = [];
    // Deliberately alphabetical in reverse of the order they will be arranged
    // into, so an alphabetical sort anywhere in the read is visible.
    for (const name of ["Zoe Ash", "Ada Vaughn", "Mo Khan"]) {
      made.push(
        await ctx.db.insert("people", { orgId: project.orgId, name, role: "Camera" }),
      );
    }
    return made;
  });
  const bookings: string[] = [];
  for (const personId of people) {
    bookings.push(
      await asA.mutation(api.projectCrew.add, {
        projectId: ids.project,
        personId: personId as never,
      }),
    );
  }

  // Arrange them: Mo, Zoe, Ada — which is neither alphabetical nor the order
  // they were booked in.
  await asA.mutation(api.projectCrew.reorder, {
    projectId: ids.project,
    orderedIds: [bookings[2], bookings[0], bookings[1]] as never,
  });

  const rows = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(rows.map((r) => r.name)).toEqual(["Mo Khan", "Zoe Ash", "Ada Vaughn"]);
});

test("a role nobody is in keeps the place it was dragged to", async () => {
  const { ids, asA } = await setup();
  const booked = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });
  const empty = await asA.mutation(api.projectCrew.add, {
    projectId: ids.project,
    role: "Gaffer",
  });

  // Unfilled roles used to be forced to the top whatever anyone arranged.
  await asA.mutation(api.projectCrew.reorder, {
    projectId: ids.project,
    orderedIds: [booked, empty],
  });

  const rows = await asA.query(api.projectCrew.listForProject, { projectId: ids.project });
  expect(rows.map((r) => r.name ?? r.role)).toEqual(["Sam Reed", "Gaffer"]);
});
