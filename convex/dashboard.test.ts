/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Give every production a client, somewhere to be, and a running order on
 * every shoot day.
 *
 * The attention feed reports everything a production is missing, so a bare
 * fixture trips those checks as well as the one the test is about. Settling
 * them keeps each test to its own subject; the checks themselves are covered
 * by their own tests below.
 */
/** The typed harness these tests run against, so the helper below sees the schema. */
type Harness = ReturnType<typeof makeHarness>;
function makeHarness() {
  return convexTest(schema, modules);
}

async function settleEverythingElse(t: Harness) {
  await t.run(async (ctx) => {
    for (const org of await ctx.db.query("organisations").collect()) {
      const location = await ctx.db.insert("locations", {
        orgId: org._id,
        name: "Studio",
        address: "1 Example Street",
      });
      const client = await ctx.db.insert("clients", { orgId: org._id, name: "Acme" });
      for (const project of await ctx.db
        .query("projects")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect()) {
        await ctx.db.patch(project._id, { locationId: location, clientId: client });
        for (const day of await ctx.db
          .query("shootDays")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect()) {
          await ctx.db.insert("scheduleItems", {
            orgId: org._id,
            projectId: project._id,
            shootDayId: day._id,
            item: "Crew call",
          });
        }
      }
    }
  });
}

test("attention feed chases crew confirmation, not call sheets", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "Brand film",
      status: "pencilled",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: future,
      locationIds: [],
    });
    const person = await ctx.db.insert("people", {
      orgId: orgA,
      name: "Sam Reed",
      role: "Sound recordist",
    });
    return { orgA, projectA, dayA, person };
  });
  await settleEverythingElse(t);
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  // Nobody booked yet.
  let items = await asA.query(api.dashboard.attention, {});
  expect(items.map((i) => i.kind)).toEqual(["no_crew"]);

  // Booked but not confirmed.
  const bookingId = await asA.mutation(api.projectCrew.add, {
    projectId: ids.projectA,
    personId: ids.person,
  });
  items = await asA.query(api.dashboard.attention, {});
  expect(items.map((i) => i.kind)).toEqual(["unconfirmed_crew"]);
  expect(items[0].label).toBe("Sam Reed still to confirm");

  // Confirmed: nothing left to chase.
  await asA.mutation(api.projectCrew.update, { id: bookingId, status: "confirmed" });
  items = await asA.query(api.dashboard.attention, {});
  expect(items).toEqual([]);
});

test("an unsent call sheet is not something to chase", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org D", clerkOrgId: "org_d" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    const day = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: future,
      locationIds: [],
    });
    const person = await ctx.db.insert("people", { orgId: org, name: "Sam", role: "Sound" });
    return { project, day, person };
  });
  await settleEverythingElse(t);
  const asD = t.withIdentity({ subject: "user_d", org_id: "org_d" });

  const bookingId = await asD.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });
  await asD.mutation(api.projectCrew.update, { id: bookingId, status: "confirmed" });

  // A draft call sheet exists and has never been sent; that is not a problem.
  await asD.mutation(api.callSheets.ensure, { shootDayId: ids.day });
  const items = await asD.query(api.dashboard.attention, {});
  expect(items).toEqual([]);
});

test("a long shoot-day history cannot crowd upcoming days out of the dashboard", async () => {
  const t = convexTest(schema, modules);
  const past = (n: number) =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org C", clerkOrgId: "org_c" });
    // Pencilled, not confirmed: the attention feed only chases unconfirmed
    // work, and this test is about the take() bound, not about status.
    const project = await ctx.db.insert("projects", { orgId: org, name: "Series", status: "pencilled" });
    // More history rows than the query's take() bound; the old by_org scan
    // read the oldest 500 first and silently dropped the upcoming day.
    for (let i = 0; i < 501; i++) {
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: past(i + 1),
        locationIds: [],
      });
    }
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
  });
  const asC = t.withIdentity({ subject: "user_c", org_id: "org_c" });

  const items = await asC.query(api.dashboard.attention, {});
  expect(items.some((i) => i.date === future && i.kind === "no_crew")).toBe(true);

  const week = await asC.query(api.dashboard.upcomingShootDays, {});
  expect(week.length).toBe(1);
  expect(week[0].date).toBe(future);
});

test("upcoming shoot days lists this week's days with confirmation counts", async () => {
  const t = convexTest(schema, modules);
  const inThree = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const inThirty = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
    const project = await ctx.db.insert("projects", { orgId: org, name: "Promo", status: "shooting" });
    const soon = await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: inThree,
      locationIds: [],
    });
    // A day outside the 7-day window must not appear
    await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: inThirty,
      locationIds: [],
    });
    // Two crew on the soon day: one confirmed, one merely sent
    await ctx.db.insert("recipients", {
      orgId: org,
      shootDayId: soon,
      name: "Ada",
      role: "DP",
      email: "ada@example.test",
      callTime: "07:00",
      token: "tok_ada",
      status: "confirmed",
    });
    await ctx.db.insert("recipients", {
      orgId: org,
      shootDayId: soon,
      name: "Ben",
      role: "Gaffer",
      email: "ben@example.test",
      callTime: "07:00",
      token: "tok_ben",
      status: "sent",
    });
    return { soon };
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  const week = await asB.query(api.dashboard.upcomingShootDays, {});
  expect(week.length).toBe(1);
  expect(week[0].shootDayId).toBe(ids.soon);
  expect(week[0].projectName).toBe("Promo");
  expect(week[0].total).toBe(2);
  expect(week[0].confirmed).toBe(1);
});

test("an unfilled role is chased separately from unconfirmed crew", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org E", clerkOrgId: "org_e" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
    const person = await ctx.db.insert("people", { orgId: org, name: "Sam", role: "Sound" });
    return { project, person };
  });
  await settleEverythingElse(t);
  const asE = t.withIdentity({ subject: "user_e", org_id: "org_e" });

  // One booked and confirmed, one role nobody is in.
  const bookingId = await asE.mutation(api.projectCrew.add, {
    projectId: ids.project,
    personId: ids.person,
  });
  await asE.mutation(api.projectCrew.update, { id: bookingId, status: "confirmed" });
  await asE.mutation(api.projectCrew.add, { projectId: ids.project, role: "Gaffer" });

  const items = await asE.query(api.dashboard.attention, {});
  // The confirmed person is settled; the empty role is not.
  expect(items.map((i) => i.kind)).toEqual(["unfilled_role"]);
  expect(items[0].label).toBe("Gaffer still to book");
});

test("a crew problem is raised once per production, not once per shoot day", async () => {
  const t = convexTest(schema, modules);
  const dayOne = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "pencilled",
    });
    // A week's shoot with nobody booked on it.
    for (const offset of [1, 2, 3, 4, 5]) {
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10),
        locationIds: [],
      });
    }
  });
  await settleEverythingElse(t);
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const items = await asA.query(api.dashboard.attention, {});

  // One production with no crew is one problem, not five — and the panel's
  // count is what the tile above it shows.
  expect(items).toHaveLength(1);
  expect(items[0].kind).toBe("no_crew");
  // It points at the first day it matters, not an arbitrary one.
  expect(items[0].date).toBe(dayOne);
});

test("a kit clash is raised on both productions, whatever their status", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    // One camera, two productions shooting the same day — and both confirmed,
    // which the crew checks deliberately ignore but a double booking is a
    // problem regardless.
    await ctx.db.insert("equipment", { orgId: org, item: "Sony FX9" });
    for (const name of ["Brand film", "Music video"]) {
      const project = await ctx.db.insert("projects", { orgId: org, name, status: "confirmed" });
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: soon,
        locationIds: [],
      });
      await ctx.db.insert("projectEquipment", {
        orgId: org,
        projectId: project,
        item: "Sony FX9",
        status: "confirmed",
      });
    }
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const items = await asA.query(api.dashboard.attention, {});
  const clashes = items.filter((i) => i.kind === "kit_clash");
  expect(clashes).toHaveLength(2);
  expect(clashes[0].label).toBe("1 item double-booked with another shoot");
  expect(clashes.map((c) => c.projectName).sort()).toEqual(["Brand film", "Music video"]);
});

test("kit that goes round is not raised on the dashboard", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    for (let i = 0; i < 2; i++) {
      await ctx.db.insert("equipment", { orgId: org, item: "Tripod" });
    }
    for (const name of ["Brand film", "Music video"]) {
      const project = await ctx.db.insert("projects", { orgId: org, name, status: "confirmed" });
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: soon,
        locationIds: [],
      });
      await ctx.db.insert("projectEquipment", {
        orgId: org,
        projectId: project,
        item: "Tripod",
        status: "confirmed",
      });
    }
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const items = await asA.query(api.dashboard.attention, {});
  expect(items.filter((i) => i.kind === "kit_clash")).toEqual([]);
});

test("a shoot overbooked on many items is one line, not many", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const kit: string[] = [];
    for (const item of ["Sony FX9", "Tripod", "Follow focus", "Matte box"]) {
      kit.push(await ctx.db.insert("equipment", { orgId: org, item }));
    }
    for (const name of ["Brand film", "Music video"]) {
      const project = await ctx.db.insert("projects", { orgId: org, name, status: "confirmed" });
      await ctx.db.insert("shootDays", {
        orgId: org,
        projectId: project,
        date: soon,
        locationIds: [],
      });
      for (const equipmentId of kit) {
        const equipment = (await ctx.db.get(equipmentId as never))!;
        await ctx.db.insert("projectEquipment", {
          orgId: org,
          projectId: project,
          item: (equipment as { item: string }).item,
          equipmentId: equipmentId as never,
          status: "confirmed",
        });
      }
    }
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });

  const clashes = (await asA.query(api.dashboard.attention, {})).filter(
    (i) => i.kind === "kit_clash",
  );
  // One line per production, counting the items — not four lines each.
  expect(clashes).toHaveLength(2);
  expect(clashes[0].label).toBe("4 items double-booked with another shoot");
});

test("a confirmed production still has its crew chased", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org F", clerkOrgId: "org_f" });
    // Confirmed with the client — which is precisely when the crew has to be
    // booked. The old feed skipped these productions entirely.
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
    const sam = await ctx.db.insert("people", { orgId: org, name: "Sam Reed", role: "Sound" });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: project, personId: sam });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: project, role: "Gaffer" });
  });
  await settleEverythingElse(t);
  const asF = t.withIdentity({ subject: "user_f", org_id: "org_f" });

  const items = await asF.query(api.dashboard.attention, {});
  expect(items.map((i) => i.label).sort()).toEqual([
    "Gaffer still to book",
    "Sam Reed still to confirm",
  ]);
});

test("every outstanding person is a line, not one line counting them", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org G", clerkOrgId: "org_g" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
    // Three pencilled, one confirmed, and two roles nobody is in.
    for (const name of ["Ada Vaughn", "Ben Okoro", "Cleo Marsh"]) {
      const personId = await ctx.db.insert("people", { orgId: org, name, role: "Camera" });
      await ctx.db.insert("projectCrew", { orgId: org, projectId: project, personId });
    }
    const settled = await ctx.db.insert("people", { orgId: org, name: "Dee Hall", role: "Grip" });
    await ctx.db.insert("projectCrew", {
      orgId: org,
      projectId: project,
      personId: settled,
      status: "confirmed",
    });
    for (const role of ["Gaffer", "Runner"]) {
      await ctx.db.insert("projectCrew", { orgId: org, projectId: project, role });
    }
  });
  await settleEverythingElse(t);
  const asG = t.withIdentity({ subject: "user_g", org_id: "org_g" });

  const items = await asG.query(api.dashboard.attention, {});
  // Five outstanding people, five lines — each one a different phone call.
  // Dee Hall has confirmed and is not among them.
  expect(items.map((i) => i.label).sort()).toEqual([
    "Ada Vaughn still to confirm",
    "Ben Okoro still to confirm",
    "Cleo Marsh still to confirm",
    "Gaffer still to book",
    "Runner still to book",
  ]);
});

test("crew on a production with no dates yet is still chased, but sorts last", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org H", clerkOrgId: "org_h" });

    const dated = await ctx.db.insert("projects", {
      orgId: org,
      name: "Dated job",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: dated, date: soon, locationIds: [] });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: dated, role: "Gaffer" });

    // Nothing in the diary yet, but a role is already open on it.
    const undated = await ctx.db.insert("projects", {
      orgId: org,
      name: "Undated job",
      status: "pencilled",
    });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: undated, role: "Runner" });
  });
  await settleEverythingElse(t);
  const asH = t.withIdentity({ subject: "user_h", org_id: "org_h" });

  const items = await asH.query(api.dashboard.attention, {});
  expect(items.map((i) => i.projectName)).toEqual(["Dated job", "Undated job"]);
  expect(items[1].date).toBeUndefined();
  expect(items[1].label).toBe("Runner still to book");
});

test("an archived production is chased for nothing", async () => {
  const t = convexTest(schema, modules);
  const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org I", clerkOrgId: "org_i" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Old job",
      status: "confirmed",
      archived: true,
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: future, locationIds: [] });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: project, role: "Gaffer" });
  });
  const asI = t.withIdentity({ subject: "user_i", org_id: "org_i" });

  expect(await asI.query(api.dashboard.attention, {})).toEqual([]);
});

test("kit still to confirm is chased, and named while there are few", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org J", clerkOrgId: "org_j" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: soon, locationIds: [] });
    for (const item of ["Sony FX9", "O'Connor tripod"]) {
      await ctx.db.insert("projectEquipment", { orgId: org, projectId: project, item, status: "needed" });
    }
    // Already sorted: not a chase.
    await ctx.db.insert("projectEquipment", {
      orgId: org,
      projectId: project,
      item: "Matte box",
      status: "confirmed",
    });
  });
  await settleEverythingElse(t);
  const asJ = t.withIdentity({ subject: "user_j", org_id: "org_j" });

  const items = await asJ.query(api.dashboard.attention, {});
  const kit = items.filter((i) => i.kind === "kit_unconfirmed");
  expect(kit).toHaveLength(1);
  expect(kit[0].label).toBe("Sony FX9 and O'Connor tripod still to confirm");
});

test("a long kit list is counted rather than recited", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org K", clerkOrgId: "org_k" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: soon, locationIds: [] });
    for (const item of ["Sony FX9", "Tripod", "Matte box", "Follow focus", "Aputure 600d"]) {
      await ctx.db.insert("projectEquipment", { orgId: org, projectId: project, item, status: "needed" });
    }
    // Two of the same thing is one thing still to confirm, not two.
    await ctx.db.insert("projectEquipment", {
      orgId: org,
      projectId: project,
      item: "  tripod ",
      status: "needed",
    });
  });
  await settleEverythingElse(t);
  const asK = t.withIdentity({ subject: "user_k", org_id: "org_k" });

  const kit = (await asK.query(api.dashboard.attention, {})).filter(
    (i) => i.kind === "kit_unconfirmed",
  );
  expect(kit).toHaveLength(1);
  expect(kit[0].label).toBe("5 items of kit still to confirm");
});

test("a release form sent and unanswered is chased; a signed one is not", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org L", clerkOrgId: "org_l" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: soon, locationIds: [] });
    const shared = {
      orgId: org,
      projectId: project,
      type: "talent_release" as const,
      data: {
        talentName: "Ada Vaughn",
        producerName: "Matt",
        productionCompany: "Boostkit",
        productionTitle: "Brand film",
        governingLaw: "England and Wales",
      },
    };
    await ctx.db.insert("documents", {
      ...shared,
      title: "Talent release — Ada Vaughn",
      status: "sent",
      signer: { name: "Ada Vaughn", email: "ada@example.test" },
      signToken: "tok_ada",
    });
    // Signed, and a draft nobody has been asked to sign yet: neither is a chase.
    await ctx.db.insert("documents", {
      ...shared,
      title: "Talent release — Ben Okoro",
      status: "signed",
      signer: { name: "Ben Okoro", email: "ben@example.test" },
      signToken: "tok_ben",
    });
    await ctx.db.insert("documents", {
      ...shared,
      title: "Talent release — Cleo Marsh",
      status: "draft",
      signer: { name: "Cleo Marsh", email: "cleo@example.test" },
      signToken: "tok_cleo",
    });
  });
  await settleEverythingElse(t);
  const asL = t.withIdentity({ subject: "user_l", org_id: "org_l" });

  const releases = (await asL.query(api.dashboard.attention, {})).filter(
    (i) => i.kind === "release_unsigned",
  );
  expect(releases).toHaveLength(1);
  expect(releases[0].label).toBe("Release form for Ada Vaughn still unsigned");
});

test("a booked job with no dates and no client is chased for both", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org M", clerkOrgId: "org_m" });
    await ctx.db.insert("projects", { orgId: org, name: "Brand film", status: "confirmed" });
    // Still an enquiry: nobody has promised anything, so neither is missing.
    await ctx.db.insert("projects", { orgId: org, name: "Enquiry", status: "not_booked" });
  });
  const asM = t.withIdentity({ subject: "user_m", org_id: "org_m" });

  const items = await asM.query(api.dashboard.attention, {});
  const booked = items.filter((i) => i.projectName === "Brand film").map((i) => i.kind);
  expect(booked).toContain("no_dates");
  expect(booked).toContain("no_client");

  const enquiry = items.filter((i) => i.projectName === "Enquiry").map((i) => i.kind);
  expect(enquiry).toEqual(["no_crew"]);
});

test("a shoot next week with nowhere to go and no running order is chased", async () => {
  const t = convexTest(schema, modules);
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org N", clerkOrgId: "org_n" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", { orgId: org, projectId: project, date: soon, locationIds: [] });
  });
  const asN = t.withIdentity({ subject: "user_n", org_id: "org_n" });

  const kinds = (await asN.query(api.dashboard.attention, {})).map((i) => i.kind);
  expect(kinds).toContain("no_location");
  expect(kinds).toContain("no_schedule");
});

test("a shoot months out is not missing what gets settled late", async () => {
  const t = convexTest(schema, modules);
  const faraway = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Org O", clerkOrgId: "org_o" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
    });
    await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: faraway,
      locationIds: [],
    });
  });
  const asO = t.withIdentity({ subject: "user_o", org_id: "org_o" });

  const kinds = (await asO.query(api.dashboard.attention, {})).map((i) => i.kind);
  // The crew still has to be booked; where and when are not late yet.
  expect(kinds).toContain("no_crew");
  expect(kinds).not.toContain("no_location");
  expect(kinds).not.toContain("no_schedule");
});
