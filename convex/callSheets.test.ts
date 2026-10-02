/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const clientId = await ctx.db.insert("clients", { orgId: orgA, name: "Acme" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      clientId,
      name: "Brand film",
      status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: "2026-06-20",
      locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  return {
    t,
    ids,
    asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }),
    asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }),
  };
}

test("ensure creates version 1 draft with defaults, and is idempotent", async () => {
  const { asA, ids } = await setup();
  const first = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const second = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  expect(first).toBe(second);
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(current?.version).toBe(1);
  expect(current?.status).toBe("draft");
  expect(current?.data.title).toBe("Brand film");
  expect(current?.data.clientName).toBe("Acme");
  expect(current?.data.productionCompany).toBe("Org A");
  expect(current?.data.date).toBe("2026-06-20");
});

test("saveDraft patches the draft", async () => {
  const { asA, ids } = await setup();
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: draftId,
    data: { ...current!.data, generalCallTime: "07:30" },
  });
  const after = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(after?.data.generalCallTime).toBe("07:30");
  expect(after?.version).toBe(1); // autosave does not bump versions
});

test("snapshot freezes the draft and starts a new one", async () => {
  const { asA, ids } = await setup();
  const v1Id = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.snapshotVersion, {
    shootDayId: ids.dayA,
    note: "Sent to crew",
  });
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(current?.version).toBe(2);
  expect(current?._id).not.toBe(v1Id);
  const versions = await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA });
  expect(versions).toHaveLength(2);
  expect(versions.find((s) => s.version === 1)?.status).toBe("snapshot");
  // frozen versions reject writes
  await expect(
    asA.mutation(api.callSheets.saveDraft, { id: v1Id, data: current!.data })
  ).rejects.toThrow("Only the draft can be edited");
});

test("restore carries old data into a new draft without rewriting history", async () => {
  const { asA, ids } = await setup();
  const v1Id = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const v1 = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: v1Id,
    data: { ...v1!.data, title: "Original title" },
  });
  await asA.mutation(api.callSheets.snapshotVersion, { shootDayId: ids.dayA });
  const v2 = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: v2!._id,
    data: { ...v2!.data, title: "Edited title" },
  });
  await asA.mutation(api.callSheets.restoreVersion, { shootDayId: ids.dayA, fromId: v1Id });
  const v3 = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(v3?.version).toBe(3);
  expect(v3?.data.title).toBe("Original title");
  expect(await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA })).toHaveLength(3);
});

test("render tokens resolve and expire", async () => {
  const { t, asA, ids } = await setup();
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const { token } = await asA.mutation(api.callSheets.createRenderToken, { id: draftId });
  const resolved = await t.query(api.callSheets.getByRenderToken, { token });
  expect(resolved?.data.title).toBe("Brand film");
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("renderTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1000 });
  });
  expect(await t.query(api.callSheets.getByRenderToken, { token })).toBeNull();
});

test("cross-org access is rejected everywhere", async () => {
  const { t, asA, asB, ids } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await expect(asB.mutation(api.callSheets.ensure, { shootDayId: ids.dayA })).rejects.toThrow();
  await expect(
    asB.mutation(api.callSheets.createRenderToken, { id: draftId })
  ).rejects.toThrow();
});

test("enriched call sheet data and org settings round-trip through the schema", async () => {
  const t = convexTest(schema, modules);
  const read = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organisations", {
      name: "Org A",
      clerkOrgId: "org_a",
      settings: {
        brandColor: "#ff0000",
        invoicing: {
          legalName: "Klaxon Studio Ltd",
          companyNumber: "15712401",
          vatNumber: "GB470025721",
          invoiceEmail: "invoices@klaxon.studio",
          receiptsNote: "Keep and submit all receipts",
        },
        confidentialByDefault: true,
      },
    });
    const projectId = await ctx.db.insert("projects", {
      orgId,
      name: "P",
      status: "brief",
    });
    const dayId = await ctx.db.insert("shootDays", {
      orgId,
      projectId,
      date: "2026-06-09",
      locationIds: [],
    });
    const csId = await ctx.db.insert("callSheets", {
      orgId,
      shootDayId: dayId,
      projectId,
      version: 1,
      status: "draft",
      data: {
        title: "T",
        date: "2026-06-09",
        generalCallTime: "07:45",
        productionCompany: "Klaxon",
        locations: [
          {
            id: "l1",
            name: "Loft",
            address: "3 Tanner St",
            satNav: "SE1 3JT",
            publicTransport: "London Bridge 10 min walk",
            nearestPoliceStation: "Southwark Police Station",
          },
        ],
        schedule: [],
        crew: [],
        contacts: [],
        callTimes: [{ id: "ct1", label: "Crew call", time: "07:45" }],
        crewSectionTitle: "Crew",
        contactSections: [
          {
            id: "s1",
            title: "Agency",
            rows: [
              { id: "r1", name: "Adam", role: "Senior Producer", email: "a@omc.com", reportsTo: "" },
            ],
          },
        ],
        camera: {
          recordingFormat: "3840x2160 S-Log3",
          frameRate: "25",
          aspectRatios: "16:9, 1:1, 9:16",
          namingConvention: "26MMDD_prodtitle_camA_001_",
          otherNotes: "2x camera, lapel + boom",
        },
        equipment: [{ id: "e1", supplier: "Klaxon Studio", item: "Sony FX9" }],
        branding: { logoUrl: "https://example/logo.png", brandColor: "#ff0000" },
        invoicing: { legalName: "Klaxon Studio Ltd", invoiceEmail: "invoices@klaxon.studio" },
        confidential: true,
      },
    });
    return await ctx.db.get(csId);
  });
  expect(read?.data.contactSections?.[0].title).toBe("Agency");
  expect(read?.data.camera?.aspectRatios).toBe("16:9, 1:1, 9:16");
  expect(read?.data.locations[0].satNav).toBe("SE1 3JT");
  expect(read?.data.equipment?.[0].item).toBe("Sony FX9");
  expect(read?.data.confidential).toBe(true);
});

test("ensure copies org defaults, seeds call times, and carries location fields", async () => {
  const t = convexTest(schema, modules);
  const { dayId } = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organisations", {
      name: "Klaxon",
      clerkOrgId: "org_a",
      settings: {
        brandColor: "#111111",
        invoicing: { legalName: "Klaxon Studio Ltd", invoiceEmail: "invoices@klaxon.studio" },
        confidentialByDefault: true,
      },
    });
    const locId = await ctx.db.insert("locations", {
      orgId,
      name: "Bermondsey Loft",
      address: "3 Tanner St, London SE1 3LE",
      satNav: "SE1 3JT",
      publicTransport: "London Bridge 10 min walk",
      nearestPoliceStation: "Southwark Police Station",
    });
    const projectId = await ctx.db.insert("projects", { orgId, name: "Barclays", status: "pre_production" });
    const dayId = await ctx.db.insert("shootDays", {
      orgId,
      projectId,
      date: "2026-06-09",
      locationIds: [locId],
    });
    return { dayId };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: dayId });
  const draft = await asA.query(api.callSheets.getCurrent, { shootDayId: dayId });
  expect(draft?.data.invoicing?.legalName).toBe("Klaxon Studio Ltd");
  expect(draft?.data.confidential).toBe(true);
  expect(draft?.data.branding?.brandColor).toBe("#111111");
  expect(draft?.data.callTimes?.[0]).toMatchObject({ label: "Crew call", time: "08:00" });
  expect(draft?.data.locations[0].satNav).toBe("SE1 3JT");
  expect(draft?.data.locations[0].nearestPoliceStation).toBe("Southwark Police Station");
});

test("cleanupExpiredRenderTokens deletes only expired token rows", async () => {
  const { t, asA, ids } = await setup();
  const sheetId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await t.run(async (ctx) => {
    await ctx.db.insert("renderTokens", { callSheetId: sheetId, token: "tok_old", expiresAt: Date.now() - 1000 });
    await ctx.db.insert("renderTokens", { callSheetId: sheetId, token: "tok_live", expiresAt: Date.now() + 60_000 });
  });
  await t.mutation(internal.callSheets.cleanupExpiredRenderTokens, {});
  const remaining = await t.run(async (ctx) => await ctx.db.query("renderTokens").collect());
  expect(remaining).toHaveLength(1);
  expect(remaining[0].token).toBe("tok_live");
});

/** A production with everything a call sheet wants to lay out. */
async function fullProduction() {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const location = await ctx.db.insert("locations", {
      orgId: ids.orgA,
      name: "Shoreditch studio",
      address: "1 Curtain Road, London",
      nearestHospital: "Royal London",
    });
    await ctx.db.patch(ids.dayA, { locationIds: [location] });

    const dp = await ctx.db.insert("people", {
      orgId: ids.orgA,
      name: "Sam Reed",
      role: "DP",
      phone: "07700 900000",
      email: "sam@example.test",
    });
    const actor = await ctx.db.insert("people", {
      orgId: ids.orgA,
      name: "Jo Patel",
      kind: "talent",
      role: "Lead",
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      personId: dp,
      status: "confirmed",
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      kind: "talent",
      personId: actor,
      status: "pencilled",
    });
    // A role nobody is in yet still belongs on the sheet, so it is chased.
    await ctx.db.insert("projectCrew", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      role: "Sound recordist",
      status: "pencilled",
    });

    await ctx.db.insert("scheduleItems", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      shootDayId: ids.dayA,
      time: "13:00",
      item: "Lunch",
    });
    await ctx.db.insert("scheduleItems", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      shootDayId: ids.dayA,
      time: "07:00",
      item: "Crew call",
      notes: "Unit base",
    });
    // Not tied to a day: it applies to the job, so it applies to this day.
    await ctx.db.insert("scheduleItems", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      item: "Rushes off-loaded nightly",
    });

    await ctx.db.insert("projectEquipment", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      item: "FX9",
      dept: "Camera",
      quantity: 2,
      section: "equipment",
      status: "confirmed",
    });
    await ctx.db.insert("projectEquipment", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      item: "Techno crane",
      section: "additional",
      status: "needed",
    });
  });

  await asA.mutation(api.clients.saveContact, {
    id: (await asA.query(api.projects.get, { id: ids.projectA }))!.clientId!,
    name: "Ali Khan",
    role: "Marketing lead",
    email: "ali@acme.test",
  });

  return { t, ids, asA };
}

test("a generated call sheet carries the whole production", async () => {
  const { ids, asA } = await fullProduction();
  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  const sheet = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  const data = sheet!.data;

  expect(data.title).toBe("Brand film");
  expect(data.date).toBe("2026-06-20");
  expect(data.clientName).toBe("Acme");

  // The first timed thing that happens is the call.
  expect(data.generalCallTime).toBe("07:00");
  expect(data.schedule.map((s) => s.title)).toEqual([
    "Crew call",
    "Lunch",
    "Rushes off-loaded nightly",
  ]);
  expect(data.schedule[0].notes).toBe("Unit base");

  // Crew and talent are separate lists, as a call sheet keeps them.
  expect(data.crew.map((c) => c.name)).toEqual(["Sam Reed", "TO BOOK"]);
  expect(data.crew[0]).toMatchObject({ role: "DP", phone: "07700 900000" });
  expect(data.crew[1].role).toBe("Sound recordist");
  const talent = data.contactSections?.find((s) => s.title === "Talent");
  expect(talent?.rows.map((r) => r.name)).toEqual(["Jo Patel"]);
  const client = data.contactSections?.find((s) => s.title === "Client");
  expect(client?.rows[0]).toMatchObject({ name: "Ali Khan", role: "Marketing lead" });

  expect(data.locations[0]).toMatchObject({
    name: "Shoreditch studio",
    nearestHospital: "Royal London",
  });
  expect(data.equipment?.map((e) => e.item)).toEqual(["2 × FX9", "Techno crane"]);
  expect(data.equipment?.[1].supplier).toBe("Hired in");
});

test("a day with no location of its own falls back to the project's", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const location = await ctx.db.insert("locations", {
      orgId: ids.orgA,
      name: "Shoreditch studio",
      address: "1 Curtain Road, London",
    });
    await ctx.db.patch(ids.projectA, { locationId: location });
  });

  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  const sheet = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(sheet?.data.locations[0].name).toBe("Shoreditch studio");
});

test("regenerating keeps the old draft as a version rather than losing it", async () => {
  const { ids, asA } = await setup();
  const draftId = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const current = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: draftId,
    data: { ...current!.data, safetyNotes: "Hard hats on the gantry" },
  });

  const result = await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  expect(result.replacedDraft).toBe(true);

  const after = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(after?.version).toBe(2);
  const versions = await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA });
  expect(versions.map((v) => v.version)).toEqual([2, 1]);
  const old = await asA.query(api.callSheets.getVersion, { id: draftId });
  expect(old?.data.safetyNotes).toBe("Hard hats on the gantry");
});

test("another org cannot generate a call sheet on your shoot day", async () => {
  const { t, ids, asB } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  await expect(
    asB.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA }),
  ).rejects.toThrow(/not found/i);
});

test("several dates combine onto one sheet, kept on the earliest", async () => {
  const { t, ids, asA } = await setup();
  const { dayB, dayC, studio, farm } = await t.run(async (ctx) => {
    const studio = await ctx.db.insert("locations", {
      orgId: ids.orgA,
      name: "Shoreditch studio",
      address: "1 Curtain Road, London",
      lat: 51.5246,
      lng: -0.0794,
    });
    const farm = await ctx.db.insert("locations", {
      orgId: ids.orgA,
      name: "Hill farm",
      address: "Frant, East Sussex",
    });
    await ctx.db.patch(ids.dayA, { locationIds: [studio] });
    const dayB = await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-06-22",
      label: "Exteriors",
      locationIds: [farm],
    });
    const dayC = await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-06-21",
      locationIds: [studio],
    });
    await ctx.db.insert("scheduleItems", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      shootDayId: dayB,
      time: "06:30",
      item: "Crew call",
    });
    await ctx.db.insert("scheduleItems", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      shootDayId: ids.dayA,
      time: "08:00",
      item: "Crew call",
    });
    return { dayB, dayC, studio, farm };
  });

  // Day 1 already has a sheet of its own, with a note on it.
  const dayOneDraft = await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  const dayOne = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.saveDraft, {
    id: dayOneDraft,
    data: { ...dayOne!.data, safetyNotes: "Day one only" },
  });

  // Picked out of order: the sheet still runs first date to last.
  const result = await asA.mutation(api.callSheets.generateCombined, {
    shootDayIds: [dayB, ids.dayA, dayC],
  });
  expect(result.projectId).toBe(ids.projectA);

  const sheet = await asA.query(api.callSheets.getCurrentCombined, { projectId: ids.projectA });
  expect(sheet?.combined).toBe(true);
  const data = sheet!.data;
  expect(data.date).toBe("2026-06-20");
  expect(data.generalCallTime).toBe("08:00");
  expect(data.locations.map((l) => l.locationId)).toEqual([studio]);
  expect(data.extraDays?.map((d) => d.date)).toEqual(["2026-06-21", "2026-06-22"]);
  const exteriors = data.extraDays![1];
  expect(exteriors).toMatchObject({ shootDayId: dayB, label: "Exteriors", generalCallTime: "06:30" });
  expect(exteriors.locations.map((l) => l.locationId)).toEqual([farm]);
  expect(exteriors.schedule.map((s) => s.title)).toEqual(["Crew call"]);
  // Row ids stay unique across the dates, so the editor can tell them apart.
  const scheduleIds = [data.schedule, ...data.extraDays!.map((d) => d.schedule)]
    .flat()
    .map((s) => s.id);
  expect(new Set(scheduleIds).size).toBe(scheduleIds.length);

  // Day 1's own sheet is untouched: still a one-day sheet, note and all.
  const stillDayOne = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(stillDayOne?._id).toBe(dayOneDraft);
  expect(stillDayOne?.data.extraDays).toBeUndefined();
  expect(stillDayOne?.data.safetyNotes).toBe("Day one only");
  const dayOneVersions = await asA.query(api.callSheets.listVersions, { shootDayId: ids.dayA });
  expect(dayOneVersions).toHaveLength(1);

  expect(await asA.query(api.callSheets.combinedForProject, { projectId: ids.projectA })).toEqual({
    id: sheet!._id,
    version: 1,
    dates: ["2026-06-20", "2026-06-21", "2026-06-22"],
    shootDayIds: [ids.dayA, dayC, dayB],
  });

  // Regenerating a day's sheet does not touch the combined one, and changing
  // the combined sheet's dates is a new version of the same sheet.
  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.generateCombined, { shootDayIds: [dayC, dayB] });
  const changed = await asA.query(api.callSheets.getCurrentCombined, { projectId: ids.projectA });
  expect(changed?.version).toBe(2);
  expect(changed?.shootDayId).toBe(dayC);
  expect(changed?.data.date).toBe("2026-06-21");
  const combinedVersions = await asA.query(api.callSheets.listCombinedVersions, {
    projectId: ids.projectA,
  });
  expect(combinedVersions.map((v) => v.version)).toEqual([2, 1]);
  const dayOneAfter = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(dayOneAfter?.combined).toBeUndefined();
  expect(dayOneAfter?.data.extraDays).toBeUndefined();

  // Restoring works within the combined sheet, and a day's version cannot be
  // restored into it.
  await asA.mutation(api.callSheets.restoreCombined, {
    projectId: ids.projectA,
    fromId: combinedVersions[1]._id,
  });
  const restored = await asA.query(api.callSheets.getCurrentCombined, { projectId: ids.projectA });
  expect(restored?.data.extraDays).toHaveLength(2);
  expect(restored?.shootDayId).toBe(ids.dayA);
  await expect(
    asA.mutation(api.callSheets.restoreCombined, {
      projectId: ids.projectA,
      fromId: dayOneDraft,
    })
  ).rejects.toThrow("Version not found");
});

test("the combined sheet is sent to its own recipients, and their link opens it", async () => {
  const { t, ids, asA } = await setup();
  // Links lapse a week after the shoot, so these dates have to stay ahead.
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const dayB = await t.run(async (ctx) => {
    await ctx.db.patch(ids.dayA, { date: inDays(2) });
    return await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: inDays(3),
      locationIds: [],
    });
  });
  const SAM = { name: "Sam", role: "DP", email: "sam@example.test", callTime: "08:00" };
  const JO = { name: "Jo", role: "Sound", email: "jo@example.test", callTime: "08:00" };

  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, { shootDayId: ids.dayA, recipients: [SAM] });
  await asA.mutation(api.callSheets.generateCombined, { shootDayIds: [ids.dayA, dayB] });
  const sentId = await asA.mutation(api.distribution.sendCombined, {
    projectId: ids.projectA,
    recipients: [SAM, JO],
  });

  const dayList = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  const combinedList = await asA.query(api.distribution.listForCombined, { projectId: ids.projectA });
  expect(dayList.map((r) => r.email)).toEqual(["sam@example.test"]);
  expect(combinedList.map((r) => r.email).sort()).toEqual(["jo@example.test", "sam@example.test"]);
  // Sam is on both, with a separate link for each.
  expect(combinedList.find((r) => r.email === SAM.email)?.token).not.toBe(dayList[0].token);

  const sent = await asA.query(api.callSheets.getVersion, { id: sentId });
  expect(sent?.status).toBe("sent");
  expect(sent?.combined).toBe(true);
  const afterSend = await asA.query(api.callSheets.getCurrentCombined, { projectId: ids.projectA });
  expect(afterSend?.combined).toBe(true);
  expect(afterSend?.version).toBe(2);
  // Day 1's own sheet was sent once and is on its next draft, not the combined one.
  const dayDraft = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(dayDraft?.version).toBe(2);
  expect(dayDraft?.data.extraDays).toBeUndefined();

  const jo = combinedList.find((r) => r.email === JO.email)!;
  const page = await t.query(api.setMode.getByToken, { token: jo.token });
  expect(page && !page.expired && page.data.extraDays?.map((d) => d.date)).toEqual([inDays(3)]);
  const samDay = await t.query(api.setMode.getByToken, { token: dayList[0].token });
  expect(samDay && !samDay.expired && samDay.data.extraDays).toBeUndefined();
});

test("combining needs two dates on the same production", async () => {
  const { t, ids, asA, asB } = await setup();
  const { otherDay, laterDay } = await t.run(async (ctx) => {
    const otherProject = await ctx.db.insert("projects", {
      orgId: ids.orgA,
      name: "Another job",
      status: "pre_production",
    });
    const otherDay = await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: otherProject,
      date: "2026-06-21",
      locationIds: [],
    });
    const laterDay = await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-06-23",
      locationIds: [],
    });
    return { otherDay, laterDay };
  });

  await expect(
    asA.mutation(api.callSheets.generateCombined, { shootDayIds: [ids.dayA, ids.dayA] })
  ).rejects.toThrow("at least two dates");
  await expect(
    asA.mutation(api.callSheets.generateCombined, { shootDayIds: [ids.dayA, otherDay] })
  ).rejects.toThrow("same production");
  await expect(
    asB.mutation(api.callSheets.generateCombined, { shootDayIds: [ids.dayA, laterDay] })
  ).rejects.toThrow();
});

test("the production's hotels come onto the call sheet", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.accommodation.add, {
    projectId: ids.projectA,
    name: "Premier Inn Tunbridge Wells",
    phone: "0333 000 0000",
    nights: 3,
    bookingRef: "PI-4471",
  });
  await asA.mutation(api.accommodation.add, { projectId: ids.projectA, name: "The Ibis" });

  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  const sheet = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(sheet?.data.hotels).toEqual([
    {
      id: "hotel-1",
      name: "Premier Inn Tunbridge Wells",
      phone: "0333 000 0000",
      nights: 3,
      bookingRef: "PI-4471",
    },
    { id: "hotel-2", name: "The Ibis" },
  ]);

  // A hotel only ever held on the day, from before accommodation moved to the
  // production, is still carried rather than lost.
  const { dayB } = await t.run(async (ctx) => ({
    dayB: await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: await ctx.db.insert("projects", {
        orgId: ids.orgA,
        name: "Older job",
        status: "pre_production",
      }),
      date: "2026-07-01",
      locationIds: [],
      accommodation: { name: "Hotel du Vin", checkIn: "From 3pm" },
    }),
  }));
  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: dayB });
  const older = await asA.query(api.callSheets.getCurrent, { shootDayId: dayB });
  expect(older?.data.hotels).toEqual([{ id: "hotel-1", name: "Hotel du Vin", checkIn: "From 3pm" }]);
});

test("crew and talent come onto the sheet in the order the production arranges them", async () => {
  const { t, ids, asA } = await setup();
  const [sound, director, camera, actorB, actorA] = await t.run(async (ctx) => {
    const book = async (role: string, kind: "crew" | "talent" = "crew") =>
      await ctx.db.insert("projectCrew", {
        orgId: ids.orgA,
        projectId: ids.projectA,
        role,
        kind,
        status: "pencilled",
      });
    // Booked in an order nobody would read a call sheet in.
    return [
      await book("Sound recordist"),
      await book("Director"),
      await book("Camera operator"),
      await book("Lead B", "talent"),
      await book("Lead A", "talent"),
    ];
  });
  await asA.mutation(api.projectCrew.reorder, {
    projectId: ids.projectA,
    orderedIds: [director, camera, sound, actorA, actorB],
  });

  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  const data = (await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA }))!.data;
  const listed = await asA.query(api.projectCrew.listForProject, { projectId: ids.projectA });

  expect(data.crew.map((c) => c.role)).toEqual(["Director", "Camera operator", "Sound recordist"]);
  expect(data.crew.map((c) => c.role)).toEqual(
    listed.filter((m) => m.kind === "crew").map((m) => m.role)
  );
  const talent = data.contactSections?.find((s) => s.title === "Talent");
  expect(talent?.rows.map((r) => r.role)).toEqual(["Lead A", "Lead B"]);
});

test("a location edited after a sheet was drafted shows on the drafts, not on what was sent", async () => {
  const { t, ids, asA } = await setup();
  const { studio, dayB } = await t.run(async (ctx) => {
    const studio = await ctx.db.insert("locations", {
      orgId: ids.orgA,
      name: "Shoreditch studio",
      address: "1 Curtain Road, London",
      parkingNotes: "Street parking",
    });
    await ctx.db.patch(ids.projectA, { locationId: studio });
    const dayB = await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-06-21",
      locationIds: [],
    });
    return { studio, dayB };
  });

  await asA.mutation(api.callSheets.generateFromProject, { shootDayId: ids.dayA });
  await asA.mutation(api.callSheets.generateCombined, { shootDayIds: [ids.dayA, dayB] });
  const sentId = await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [{ name: "Sam", role: "DP", email: "sam@example.test", callTime: "08:00" }],
  });

  await asA.mutation(api.locations.update, {
    id: studio,
    parkingNotes: "NCP on Great Eastern Street",
    accessNotes: "Side door, buzz Unit 4",
    nearestRail: "Shoreditch High Street, 4 min walk",
  });

  const day = await asA.query(api.callSheets.getCurrent, { shootDayId: ids.dayA });
  expect(day?.data.locations[0]).toMatchObject({
    locationId: studio,
    parkingNotes: "NCP on Great Eastern Street",
    accessNotes: "Side door, buzz Unit 4",
    nearestRail: "Shoreditch High Street, 4 min walk",
  });
  const combined = await asA.query(api.callSheets.getCurrentCombined, { projectId: ids.projectA });
  expect(combined?.data.locations[0].parkingNotes).toBe("NCP on Great Eastern Street");
  expect(combined?.data.extraDays?.[0].locations[0].accessNotes).toBe("Side door, buzz Unit 4");

  // What went out stays as it went out.
  const sent = await asA.query(api.callSheets.getVersion, { id: sentId });
  expect(sent?.data.locations[0].parkingNotes).toBe("Street parking");
});

test("each date on a combined sheet carries its own day's weather", async () => {
  const { t, ids, asA } = await setup();
  const dayB = await t.run(async (ctx) => {
    await ctx.db.patch(ids.dayA, {
      weather: { fetchedAt: 1, summary: "Clear", tempMinC: 10, tempMaxC: 18 },
      sun: { sunrise: "04:43", sunset: "21:21" },
    });
    return await ctx.db.insert("shootDays", {
      orgId: ids.orgA,
      projectId: ids.projectA,
      date: "2026-06-21",
      locationIds: [],
      weather: { fetchedAt: 1, summary: "Light rain", tempMinC: 9.6, tempMaxC: 14.2 },
      sun: { sunrise: "04:44", sunset: "21:21" },
    });
  });

  await asA.mutation(api.callSheets.generateCombined, { shootDayIds: [ids.dayA, dayB] });
  const data = (await asA.query(api.callSheets.getCurrentCombined, { projectId: ids.projectA }))!
    .data;
  expect(data.weatherSummary).toBe("Clear, 10–18°C");
  expect(data.extraDays?.[0]).toMatchObject({
    weatherSummary: "Light rain, 10–14°C",
    sunrise: "04:44",
  });
});
