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
    const person = await ctx.db.insert("people", { orgId: org, name: "Sam Reed", role: "Gaffer" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
      archived: true,
    });
    await ctx.db.insert("shootDays", {
      orgId: org,
      projectId: project,
      date: "2026-09-01",
      locationIds: [],
    });
    await ctx.db.insert("projectCrew", { orgId: org, projectId: project, personId: person });
    await ctx.db.insert("projectEquipment", {
      orgId: org,
      projectId: project,
      item: "Sony FX9",
      status: "confirmed",
    });
    return { org, project, person };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("deleting an archived project takes everything that belongs only to it", async () => {
  const { t, ids, asA } = await setup();

  const result = await asA.mutation(api.projects.remove, { id: ids.project });

  // The project, its shoot day, its crew booking and its equipment line.
  expect(result.deleted).toBe(4);
  expect(await t.run(async (ctx) => await ctx.db.get(ids.project))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.query("shootDays").collect())).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.query("projectCrew").collect())).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.query("projectEquipment").collect())).toEqual([]);
});

test("company records survive the project being deleted", async () => {
  const { t, ids, asA } = await setup();

  await asA.mutation(api.projects.remove, { id: ids.project });

  // The person was booked on the job; they do not belong to it.
  expect(await t.run(async (ctx) => await ctx.db.get(ids.person))).not.toBeNull();
});

test("a live project cannot be deleted without archiving it first", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => await ctx.db.patch(ids.project, { archived: false }));

  await expect(asA.mutation(api.projects.remove, { id: ids.project })).rejects.toThrow(
    /Archive the project before deleting it/,
  );
  expect(await t.run(async (ctx) => await ctx.db.get(ids.project))).not.toBeNull();
});

test("deleting a project detaches its quote and removes the rows that belonged to it", async () => {
  const { t, ids, asA } = await setup();
  const other = await t.run(async (ctx) => {
    const day = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", ids.project))
      .unique();
    const client = await ctx.db.insert("clients", { orgId: ids.org, name: "Alan" });
    const kept = await ctx.db.insert("projects", {
      orgId: ids.org,
      name: "Other job",
      status: "pencilled",
    });
    const quote = await ctx.db.insert("quotes", {
      orgId: ids.org,
      projectId: ids.project,
      number: "260921_Ala_1",
      title: "The enquiry",
      status: "draft",
      contingencyBp: 1000,
      profitBp: 1000,
      insuranceBp: 30,
      vatBp: 2000,
      roundToPence: 500,
    });
    const keptQuote = await ctx.db.insert("quotes", {
      orgId: ids.org,
      projectId: kept,
      number: "260921_Ala_2",
      status: "draft",
      contingencyBp: 1000,
      profitBp: 1000,
      insuranceBp: 30,
      vatBp: 2000,
      roundToPence: 500,
    });
    const sheet = await ctx.db.insert("callSheets", {
      orgId: ids.org,
      shootDayId: day!._id,
      projectId: ids.project,
      version: 1,
      status: "draft",
      data: {
        title: "Brand film",
        date: "2026-09-01",
        generalCallTime: "08:00",
        productionCompany: "Org A",
        locations: [],
        schedule: [],
        crew: [],
        contacts: [],
      },
    });
    const recipient = await ctx.db.insert("recipients", {
      orgId: ids.org,
      shootDayId: day!._id,
      name: "Sam Reed",
      role: "Gaffer",
      email: "sam@example.test",
      callTime: "08:00",
      token: "tok",
      status: "pending",
      combinedProjectId: ids.project,
    });
    await ctx.db.insert("sends", {
      orgId: ids.org,
      recipientId: recipient,
      callSheetId: sheet,
      channel: "email",
      status: "pending",
    });
    await ctx.db.insert("scheduleItems", {
      orgId: ids.org,
      projectId: ids.project,
      item: "Crew call",
    });
    await ctx.db.insert("accommodation", {
      orgId: ids.org,
      projectId: ids.project,
      name: "Premier Inn",
    });
    await ctx.db.insert("projectClients", {
      orgId: ids.org,
      projectId: ids.project,
      clientId: client,
      contactId: "c1",
    });
    await ctx.db.insert("calendarEvents", {
      orgId: ids.org,
      projectId: ids.project,
      shootDayId: day!._id,
      personId: ids.person,
      email: "sam@example.test",
      eventId: "evt",
      summary: "Brand film",
      date: "2026-09-01",
      state: "synced",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("documents", {
      orgId: ids.org,
      projectId: ids.project,
      type: "talent_release",
      title: "Talent release: Sam",
      status: "draft",
      data: {
        talentName: "Sam Reed",
        producerName: "Alex",
        productionCompany: "Org A",
        productionTitle: "Brand film",
        compensation: "£1",
        governingLaw: "England and Wales",
      },
      signer: { name: "Sam Reed", email: "sam@example.test" },
      signToken: "sign-tok",
    });
    return { quote, keptQuote, client };
  });

  await asA.mutation(api.projects.remove, { id: ids.project });

  const quote = await t.run(async (ctx) => await ctx.db.get(other.quote));
  expect(quote).not.toBeNull();
  expect(quote!.projectId).toBeUndefined();
  expect(quote!.number).toBe("260921_Ala_1");

  const loose = await asA.query(api.quotes.listUnattached, {});
  expect(loose.map((q) => q._id)).toEqual([other.quote]);

  const keptQuote = await t.run(async (ctx) => await ctx.db.get(other.keptQuote));
  expect(keptQuote!.projectId).toBeDefined();

  const left = await t.run(async (ctx) => ({
    sheets: await ctx.db.query("callSheets").collect(),
    recipients: await ctx.db.query("recipients").collect(),
    sends: await ctx.db.query("sends").collect(),
    schedule: await ctx.db.query("scheduleItems").collect(),
    stays: await ctx.db.query("accommodation").collect(),
    bookings: await ctx.db.query("projectClients").collect(),
    calendar: await ctx.db.query("calendarEvents").collect(),
    documents: await ctx.db.query("documents").collect(),
    client: await ctx.db.get(other.client),
  }));
  expect(left.sheets).toEqual([]);
  expect(left.recipients).toEqual([]);
  expect(left.sends).toEqual([]);
  expect(left.schedule).toEqual([]);
  expect(left.stays).toEqual([]);
  expect(left.bookings).toEqual([]);
  expect(left.calendar).toEqual([]);
  expect(left.documents).toEqual([]);
  // The client company is not the booking.
  expect(left.client).not.toBeNull();
});

test("another org cannot delete this project", async () => {
  const { t, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  await expect(asB.mutation(api.projects.remove, { id: ids.project })).rejects.toThrow(
    /Project not found/,
  );
});
