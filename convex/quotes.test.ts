/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { RATE_CARD_SEED } from "./lib/rateCardSeed";

const modules = import.meta.glob("./**/*.ts");
const p = (pounds: number) => Math.round(pounds * 100);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_a" });
    await ctx.db.insert("organisations", { name: "Someone else", clerkOrgId: "org_b" });
    const client = await ctx.db.insert("clients", { orgId: org, name: "Alan" });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Veeam docuseries",
      status: "pencilled",
      clientId: client,
    });
    return { org, client, project };
  });
  return {
    t,
    ids,
    asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }),
    asCharlie: t.withIdentity({ subject: "user_charlie", org_id: "org_a" }),
    asB: t.withIdentity({ subject: "user_b", org_id: "org_b" }),
  };
}

test("a new quote takes the house margins and the client off the project", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const loaded = await asA.query(api.quotes.get, { id });

  expect(loaded!.quote.contingencyBp).toBe(1000);
  expect(loaded!.quote.profitBp).toBe(1000);
  expect(loaded!.quote.insuranceBp).toBe(30);
  expect(loaded!.quote.vatBp).toBe(2000);
  expect(loaded!.quote.clientName).toBe("Alan");
  expect(loaded!.quote.status).toBe("draft");
});

// The shape the spreadsheet used: 26_Ala_QV1, then QV2 for the next one.
test("quote numbers follow the house scheme and do not collide", async () => {
  const { ids, asA } = await setup();
  const first = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const second = await asA.mutation(api.quotes.create, { projectId: ids.project });

  const a = await asA.query(api.quotes.get, { id: first });
  const b = await asA.query(api.quotes.get, { id: second });
  // The date backwards, who it is for, then which go this is.
  expect(a!.quote.number).toMatch(/^\d{6}_Ala_1$/);
  expect(b!.quote.number).toMatch(/^\d{6}_Ala_2$/);
});

test("a line is priced off the cost and the quote's margins", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "production",
    name: "Director of Photography",
    unit: "day",
    pax: 1,
    unitAmount: 3,
    costPence: p(457.19),
  });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  // 457.19 x 1.203 = 549.99, rounded up to the nearest fiver.
  expect(loaded!.lines[0].ratePence).toBe(p(550));
  expect(loaded!.totals.subtotal).toBe(p(1650));
});

// Stock licensing on the real quote: £21,800 charged at what it costs.
test("a pass-through line keeps the rate it was given", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "post",
    name: "Stock Licensing",
    unit: "generic",
    costPence: p(21800),
    ratePence: p(21800),
  });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines[0].ratePence).toBe(p(21800));
  expect(loaded!.lines[0].rateOverridden).toBe(true);
});

test("moving a margin re-prices every line, hand-set ones included", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "production",
    name: "Camera Op",
    unit: "day",
    costPence: p(399),
  });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "post",
    name: "Archiving",
    unit: "generic",
    costPence: p(150),
    ratePence: p(150),
  });

  // Profit off, so the multiplier drops from 1.203 to 1.103.
  await asA.mutation(api.quotes.update, { id: quoteId, profitBp: 0 });
  await asA.mutation(api.quotes.repriceLines, { quoteId });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  const byName = Object.fromEntries(loaded!.lines.map((l) => [l.name, l.ratePence]));
  expect(byName["Camera Op"]).toBe(p(445)); // 399 x 1.103 = 440.10, up to 445
  // A hand-set line moves too. This one was added with a cost and a rate both
  // £150, so the cost is £150 and the new margins put it at 150 x 1.103 = 165.45,
  // up to the next fiver.
  expect(byName["Archiving"]).toBe(p(170));
});

// A quote that has gone out must not move when the rate card does.
test("editing the rate card does not touch a quote already written", async () => {
  const { ids, asA } = await setup();
  const itemId = await asA.mutation(api.rateCard.add, {
    category: "production",
    section: "PRODUCTION CREW",
    name: "Camera Op",
    unit: "day",
    costPence: p(399),
  });
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addFromRateCard, { quoteId, itemIds: [itemId], unitAmount: 3 });

  await asA.mutation(api.rateCard.update, { id: itemId, costPence: p(500) });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines.every((l) => l.costPence === p(399))).toBe(true);
  expect(loaded!.lines.every((l) => l.ratePence === p(480))).toBe(true);
});

test("deleting a rate card line does not empty a quote that carries it", async () => {
  const { ids, asA } = await setup();
  const itemId = await asA.mutation(api.rateCard.add, {
    category: "equipment",
    section: "EQUIPMENT",
    name: "Sony FX9 Camera Kit",
    unit: "day",
    costPence: p(224.44),
  });
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.rateCard.remove, { id: itemId });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines).toHaveLength(1);
  expect(loaded!.lines[0].name).toBe("Sony FX9 Camera Kit");
  expect(loaded!.lines[0].costPence).toBe(p(224.44));
});

test("a category total can be set by hand, and the contingency absorbs it", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "pre",
    name: "Producer",
    unit: "day",
    unitAmount: 2,
    costPence: p(486.28),
    ratePence: p(585),
  });

  await asA.mutation(api.quotes.setCategoryTotal, {
    quoteId,
    category: "pre",
    totalPence: p(1200),
  });
  let loaded = await asA.query(api.quotes.get, { id: quoteId });
  let pre = loaded!.byCategory.find((c) => c.category === "pre")!;
  expect(pre.totals.total).toBe(p(1200));
  expect(pre.totals.cost + pre.totals.contingency + pre.totals.profit + pre.totals.insurance).toBe(
    p(1200)
  );

  // And taking it off puts the category back on the sum of its lines.
  await asA.mutation(api.quotes.setCategoryTotal, { quoteId, category: "pre", totalPence: null });
  loaded = await asA.query(api.quotes.get, { id: quoteId });
  pre = loaded!.byCategory.find((c) => c.category === "pre")!;
  expect(pre.totals.total).toBe(p(1170));
});

test("VAT is worked out after the discount", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "post",
    name: "Offline Editor",
    unit: "day",
    unitAmount: 10,
    costPence: p(415.63),
    ratePence: p(500),
  });
  await asA.mutation(api.quotes.update, { id: quoteId, discountPence: p(1000) });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.totals.subtotal).toBe(p(5000));
  expect(loaded!.totals.netTotal).toBe(p(4000));
  expect(loaded!.totals.vat).toBe(p(800));
  expect(loaded!.totals.grossTotal).toBe(p(4800));
});

test("sending a quote stamps when it went out, and only once", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.update, { id: quoteId, status: "sent" });
  const first = (await asA.query(api.quotes.get, { id: quoteId }))!.quote.issuedAt;
  expect(first).toBeGreaterThan(0);

  await asA.mutation(api.quotes.update, { id: quoteId, status: "declined" });
  await asA.mutation(api.quotes.update, { id: quoteId, status: "sent" });
  expect((await asA.query(api.quotes.get, { id: quoteId }))!.quote.issuedAt).toBe(first);
});

test("crew booked on the job arrive at the rate card's price for the role", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.rateCard.add, {
    category: "production",
    section: "PRODUCTION CREW",
    name: "Director of Photography",
    unit: "day",
    costPence: p(457.19),
  });
  await t.run(async (ctx) => {
    const person = await ctx.db.insert("people", {
      orgId: ids.org,
      name: "Sam Reed",
      role: "Director of Photography",
      dayRate: 400,
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.org,
      projectId: ids.project,
      personId: person,
      role: "Director of Photography",
      status: "confirmed",
    });
  });

  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  expect(await asA.mutation(api.quotes.addCrewFromProject, { quoteId, unitAmount: 3 })).toEqual({
    added: 1,
  });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines[0]).toMatchObject({
    name: "Director of Photography",
    notes: "Sam Reed",
    costPence: p(457.19),
    ratePence: p(550),
    unitAmount: 3,
  });
});

test("crew whose role is not on the card come in at their own day rate", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    const person = await ctx.db.insert("people", {
      orgId: ids.org,
      name: "Jo Fisher",
      role: "Underwater Unit",
      dayRate: 725,
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.org,
      projectId: ids.project,
      personId: person,
      role: "Underwater Unit",
    });
  });

  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addCrewFromProject, { quoteId });
  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines[0].costPence).toBe(p(725));
});

test("the kit list arrives priced, hire-ins at what they cost", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.rateCard.add, {
    category: "equipment",
    section: "EQUIPMENT",
    name: "Sony FX9 Camera Kit",
    unit: "day",
    costPence: p(224.44),
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "Sony FX9 Camera Kit",
    quantity: 2,
    section: "equipment",
  });
  await asA.mutation(api.projectEquipment.add, {
    projectId: ids.project,
    item: "40ft Techno Crane",
    cost: 1450,
    section: "additional",
  });

  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  expect(await asA.mutation(api.quotes.addKitFromProject, { quoteId, unitAmount: 3 })).toEqual({
    added: 2,
  });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  const byName = Object.fromEntries(loaded!.lines.map((l) => [l.name, l]));
  expect(byName["Sony FX9 Camera Kit"]).toMatchObject({ costPence: p(224.44), pax: 2 });
  expect(byName["40ft Techno Crane"].costPence).toBe(p(1450));
});

test("the rate card seeds in full, and seeding again doubles nothing up", async () => {
  const { asA } = await setup();
  const result = await asA.mutation(api.rateCard.seed, {});
  expect(result.added).toBeGreaterThan(200);

  const card = await asA.query(api.rateCard.list, {});
  expect(card.length).toBe(result.added);
  expect(card.some((i) => i.name === "Director of Photography")).toBe(true);
  expect(card.some((i) => i.name === "Sony FX9 Camera Kit")).toBe(true);

  // Run twice, nothing is added and nothing is duplicated: seeding fills
  // gaps rather than refusing, so a card that predates a new section can
  // gain it without anybody rebuilding the card by hand.
  expect((await asA.mutation(api.rateCard.seed, {})).added).toBe(0);
  expect((await asA.query(api.rateCard.list, {})).length).toBe(result.added);
});

test("deleting a quote takes its lines and overrides with it", async () => {
  const { t, ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "pre",
    name: "Producer",
    unit: "day",
    costPence: p(486.28),
  });
  await asA.mutation(api.quotes.setCategoryTotal, {
    quoteId,
    category: "pre",
    totalPence: p(600),
  });
  await asA.mutation(api.quotes.remove, { id: quoteId });

  const left = await t.run(async (ctx) => ({
    lines: await ctx.db.query("quoteLines").collect(),
    overrides: await ctx.db.query("quoteCategoryOverrides").collect(),
    quotes: await ctx.db.query("quotes").collect(),
  }));
  expect(left.lines).toHaveLength(0);
  expect(left.overrides).toHaveLength(0);
  expect(left.quotes).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// A quote before there is a job to hang it on
// ---------------------------------------------------------------------------

test("typing a rate works the cost out backwards", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "production",
    name: "Camera Op",
    unit: "day",
    costPence: p(399),
  });
  let loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines[0].ratePence).toBe(p(480));

  // The client will bear £600. The cost that leaves, at 10/10/0.3, is what
  // the line should carry — otherwise the margin the quote claims is fiction.
  await asA.mutation(api.quotes.updateLine, {
    id: loaded!.lines[0]._id,
    ratePence: p(600),
  });
  loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines[0].ratePence).toBe(p(600));
  expect(loaded!.lines[0].costPence).toBeCloseTo(p(498.75), -0.5);
  expect(loaded!.lines[0].rateOverridden).toBe(true);
});

test("setting cost and rate together leaves both exactly as given", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const id = await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "post",
    name: "Stock Licensing",
    unit: "generic",
    costPence: p(21800),
    ratePence: p(21800),
  });
  await asA.mutation(api.quotes.updateLine, {
    id,
    costPence: p(19000),
    ratePence: p(19000),
  });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines[0].costPence).toBe(p(19000));
  expect(loaded!.lines[0].ratePence).toBe(p(19000));
});

// Moving a margin is a statement about the whole quote, so a line whose rate
// was typed moves with it — from the cost that rate implied.
test("a hand-typed rate moves when the margins move", async () => {
  const { ids, asA } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const id = await asA.mutation(api.quotes.addLine, {
    quoteId,
    category: "production",
    name: "Camera Op",
    unit: "day",
    costPence: p(399),
  });
  await asA.mutation(api.quotes.updateLine, { id, ratePence: p(600) });
  await asA.mutation(api.quotes.update, { id: quoteId, profitBp: 0 });
  await asA.mutation(api.quotes.repriceLines, { quoteId });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  // 600 / 1.203 = 498.75 cost, then x 1.103 = 550.12, up to the next fiver.
  expect(loaded!.lines[0].ratePence).toBe(p(555));
});

test("a quote can be started with no production at all", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, {
    clientId: ids.client,
    title: "Docuseries, three episodes",
  });

  const loaded = await asA.query(api.quotes.get, { id });
  expect(loaded!.quote.projectId).toBeUndefined();
  expect(loaded!.quote.title).toBe("Docuseries, three episodes");
  expect(loaded!.quote.clientName).toBe("Alan");
  expect(loaded!.project).toBeNull();
});

test("a quote with nobody named still gets a number", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.quotes.create, {});
  const loaded = await asA.query(api.quotes.get, { id });
  expect(loaded!.quote.number).toMatch(/^\d{6}_Job_1$/);
});

test("an unattached quote is offered to a production, an attached one is not", async () => {
  const { ids, asA } = await setup();
  const loose = await asA.mutation(api.quotes.create, { title: "An enquiry" });
  await asA.mutation(api.quotes.create, { projectId: ids.project });

  const offered = await asA.query(api.quotes.listUnattached, {});
  expect(offered.map((q) => q._id)).toEqual([loose]);
});

test("putting a quote on a production shows it there and takes it off the pile", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { title: "An enquiry" });
  await asA.mutation(api.quotes.setProject, { id, projectId: ids.project });

  expect(await asA.query(api.quotes.listUnattached, {})).toEqual([]);
  const onProject = await asA.query(api.quotes.listForProject, { projectId: ids.project });
  expect(onProject.map((q) => q._id)).toEqual([id]);
});

// The quote is the document. Whoever it was addressed to does not change
// because it was later filed against a job for somebody else.
test("attaching fills in a missing client but never overwrites one", async () => {
  const { t, ids, asA } = await setup();
  const other = await t.run((ctx) =>
    ctx.db.insert("clients", { orgId: ids.org, name: "Somebody else" })
  );

  const blank = await asA.mutation(api.quotes.create, { title: "No client yet" });
  await asA.mutation(api.quotes.setProject, { id: blank, projectId: ids.project });
  expect((await asA.query(api.quotes.get, { id: blank }))!.quote.clientName).toBe("Alan");

  const named = await asA.mutation(api.quotes.create, { clientId: other, title: "Theirs" });
  await asA.mutation(api.quotes.setProject, { id: named, projectId: ids.project });
  expect((await asA.query(api.quotes.get, { id: named }))!.quote.clientName).toBe(
    "Somebody else"
  );
});

test("a quote can be taken back off a production", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.setProject, { id, projectId: null });

  expect(await asA.query(api.quotes.listForProject, { projectId: ids.project })).toEqual([]);
  expect((await asA.query(api.quotes.listUnattached, {})).map((q) => q._id)).toEqual([id]);
});

test("pulling in crew or kit asks for a production first", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { title: "No job yet" });

  await expect(
    asA.mutation(api.quotes.addCrewFromProject, { quoteId: id })
  ).rejects.toThrow(/on a production first/i);
  await expect(
    asA.mutation(api.quotes.addKitFromProject, { quoteId: id })
  ).rejects.toThrow(/on a production first/i);
});

test("a quote cannot be filed against another account's production", async () => {
  const { t, asA, asB } = await setup();
  const theirProject = await t.run(async (ctx) => {
    const org = await ctx.db
      .query("organisations")
      .filter((q) => q.eq(q.field("clerkOrgId"), "org_b"))
      .unique();
    return ctx.db.insert("projects", { orgId: org!._id, name: "Theirs", status: "confirmed" });
  });
  const id = await asA.mutation(api.quotes.create, { title: "Mine" });

  await expect(
    asA.mutation(api.quotes.setProject, { id, projectId: theirProject })
  ).rejects.toThrow(/not found/i);
  await expect(
    asB.mutation(api.quotes.setProject, { id, projectId: theirProject })
  ).rejects.toThrow(/not found/i);
  expect(await asB.query(api.quotes.listUnattached, {})).toEqual([]);
});

// ---------------------------------------------------------------------------
// Everything chargeable is on the quote from the start
// ---------------------------------------------------------------------------

test("a new quote carries every line on the rate card, priced but empty", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.rateCard.add, {
    category: "production",
    section: "PRODUCTION CREW",
    name: "Camera Op",
    unit: "day",
    costPence: p(399),
  });
  await asA.mutation(api.rateCard.add, {
    category: "post",
    section: "POST - PRODUCTION",
    name: "Offline Editor",
    unit: "day",
    costPence: p(415.63),
  });

  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const loaded = await asA.query(api.quotes.get, { id: quoteId });

  expect(loaded!.lines.map((l) => l.name).sort()).toEqual(["Camera Op", "Offline Editor"]);
  // Priced, so the figure is there the moment somebody says how many.
  expect(loaded!.lines.every((l) => l.ratePence > 0)).toBe(true);
  // But nothing against them, so nothing is on the quote yet.
  expect(loaded!.lines.every((l) => l.pax === 0 && l.unitAmount === 0)).toBe(true);
  expect(loaded!.totals.netTotal).toBe(0);
});

test("a line only counts once it has how many and how long", async () => {
  const { ids, asA } = await setup();
  await asA.mutation(api.rateCard.add, {
    category: "production",
    section: "PRODUCTION CREW",
    name: "Camera Op",
    unit: "day",
    costPence: p(399),
  });
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const line = (await asA.query(api.quotes.get, { id: quoteId }))!.lines[0];

  // Only one of the two filled in is still nothing.
  await asA.mutation(api.quotes.updateLine, { id: line._id, pax: 1 });
  expect((await asA.query(api.quotes.get, { id: quoteId }))!.totals.netTotal).toBe(0);

  await asA.mutation(api.quotes.updateLine, { id: line._id, unitAmount: 3 });
  expect((await asA.query(api.quotes.get, { id: quoteId }))!.totals.netTotal).toBe(p(1440));
});

test("pulling in the crew fills the line that is already there", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.rateCard.add, {
    category: "production",
    section: "PRODUCTION CREW",
    name: "Director of Photography",
    unit: "day",
    costPence: p(457.19),
  });
  await t.run(async (ctx) => {
    const person = await ctx.db.insert("people", {
      orgId: ids.org,
      name: "Sam Reed",
      role: "Director of Photography",
    });
    await ctx.db.insert("projectCrew", {
      orgId: ids.org,
      projectId: ids.project,
      personId: person,
      role: "Director of Photography",
    });
  });

  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addCrewFromProject, { quoteId, unitAmount: 3 });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  // One row, filled in — not a second one beside the blank original.
  expect(loaded!.lines).toHaveLength(1);
  expect(loaded!.lines[0]).toMatchObject({ pax: 1, unitAmount: 3, notes: "Sam Reed" });
});

test("a new quote comes with the standing terms on it", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.quotes.create, {});
  const caveats = (await asA.query(api.quotes.get, { id }))!.quote.caveats ?? [];

  expect(caveats.some((c) => /valid for 30 days/i.test(c))).toBe(true);
  expect(caveats.some((c) => /three edit amends are included per deliverable/i.test(c))).toBe(
    true
  );
});

test("the house caveats win over the standing ones where there are any", async () => {
  const { t, ids, asA } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("caveats", { orgId: ids.org, text: "- Ours, not yours.", alwaysInclude: true })
  );
  const id = await asA.mutation(api.quotes.create, {});
  expect((await asA.query(api.quotes.get, { id }))!.quote.caveats).toEqual([
    "- Ours, not yours.",
  ]);
});

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

test("a new version is a copy, numbered on, with the old one left as sent", async () => {
  const { ids, asA } = await setup();
  const first = await asA.mutation(api.quotes.create, {
    projectId: ids.project,
    title: "Veeam docuseries",
  });
  await asA.mutation(api.quotes.addLine, {
    quoteId: first,
    category: "production",
    name: "Camera Op",
    unit: "day",
    pax: 1,
    unitAmount: 3,
    costPence: p(399),
  });
  await asA.mutation(api.quotes.setCategoryTotal, {
    quoteId: first,
    category: "production",
    totalPence: p(1500),
  });
  await asA.mutation(api.quotes.update, { id: first, status: "sent" });

  const secondId = await asA.mutation(api.quotes.newVersion, { id: first });
  const one = await asA.query(api.quotes.get, { id: first });
  const two = await asA.query(api.quotes.get, { id: secondId });

  expect(one!.quote.number).toMatch(/_1$/);
  expect(two!.quote.number).toBe(one!.quote.number.replace(/_1$/, "_2"));
  // The copy starts again as a draft; what went out keeps its stamp.
  expect(two!.quote.status).toBe("draft");
  expect(two!.quote.issuedAt).toBeUndefined();
  expect(one!.quote.status).toBe("sent");
  expect(one!.quote.issuedAt).toBeGreaterThan(0);
  // And it is the same quote: lines, overrides and totals come across.
  expect(two!.totals.netTotal).toBe(one!.totals.netTotal);
  expect(two!.lines.map((l) => l.name)).toEqual(one!.lines.map((l) => l.name));
  expect(two!.overrides).toEqual(one!.overrides);
});

test("versions keep going up rather than colliding", async () => {
  const { asA } = await setup();
  const first = await asA.mutation(api.quotes.create, { title: "Docuseries" });
  const second = await asA.mutation(api.quotes.newVersion, { id: first });
  const third = await asA.mutation(api.quotes.newVersion, { id: second });

  const numbers = await Promise.all(
    [first, second, third].map(async (id) => (await asA.query(api.quotes.get, { id }))!.quote.number)
  );
  expect(numbers.map((n) => n.split("_")[2])).toEqual(["1", "2", "3"]);
  expect(new Set(numbers).size).toBe(3);
});

// ---------------------------------------------------------------------------
// Archiving, and whose name goes on the client copy
// ---------------------------------------------------------------------------

test("an archived quote leaves the list, the production and the picker", async () => {
  const { ids, asA } = await setup();
  const onJob = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const loose = await asA.mutation(api.quotes.create, { title: "An enquiry" });

  await asA.mutation(api.quotes.setArchived, { id: onJob, archived: true });
  await asA.mutation(api.quotes.setArchived, { id: loose, archived: true });

  expect(await asA.query(api.quotes.list, {})).toEqual([]);
  expect(await asA.query(api.quotes.listForProject, { projectId: ids.project })).toEqual([]);
  expect(await asA.query(api.quotes.listUnattached, {})).toEqual([]);

  const put = await asA.query(api.quotes.list, { archivedOnly: true });
  expect(put.map((q) => q._id).sort()).toEqual([onJob, loose].sort());
  expect(put.every((q) => q.archived)).toBe(true);
});

// Put away, not deleted: a quote that lost the job is still the record of
// what was offered.
test("an archived quote still opens, with everything on it", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addLine, {
    quoteId: id,
    category: "production",
    name: "Camera Op",
    unit: "day",
    pax: 1,
    unitAmount: 3,
    costPence: p(399),
  });
  await asA.mutation(api.quotes.setArchived, { id, archived: true });

  const loaded = await asA.query(api.quotes.get, { id });
  expect(loaded!.quote.archived).toBe(true);
  expect(loaded!.totals.netTotal).toBe(p(1440));
});

test("restoring puts it back where it was", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.setArchived, { id, archived: true });
  await asA.mutation(api.quotes.setArchived, { id, archived: false });

  expect((await asA.query(api.quotes.list, {})).map((q) => q._id)).toEqual([id]);
  expect(await asA.query(api.quotes.list, { archivedOnly: true })).toEqual([]);
  expect(
    (await asA.query(api.quotes.listForProject, { projectId: ids.project })).map((q) => q._id)
  ).toEqual([id]);
});

test("archiving does not reach another account's quote", async () => {
  const { ids, asA, asB } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await expect(
    asB.mutation(api.quotes.setArchived, { id, archived: true })
  ).rejects.toThrow(/not found/i);
});

test("the client copy is prepared by the name they set, not their email", async () => {
  const { asA } = await setup();
  await asA.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });
  const id = await asA.mutation(api.quotes.create, { title: "Docuseries" });

  expect((await asA.query(api.quotes.get, { id }))!.quote.producerName).toBe("Matt West");
});

test("whoever writes a quote owns it", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const loaded = await asA.query(api.quotes.get, { id });
  expect(loaded!.quote.ownerId).toBe("user_a");
  expect(loaded!.quote.createdBy).toBe("user_a");
});

// The name on the client copy is the owner's, so handing a quote over hands
// over whose quote it reads as.
test("handing a quote over changes the name on the client copy", async () => {
  const { ids, asA, asCharlie } = await setup();
  await asA.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });
  await asCharlie.mutation(api.memberProfiles.setName, {
    firstName: "Charlie",
    lastName: "Fox",
  });

  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  expect((await asA.query(api.quotes.get, { id }))!.quote.producerName).toBe("Matt West");

  await asA.mutation(api.quotes.update, { id, ownerId: "user_charlie" });
  const handed = await asA.query(api.quotes.get, { id });
  expect(handed!.quote.ownerId).toBe("user_charlie");
  expect(handed!.quote.producerName).toBe("Charlie Fox");
  // Who wrote it does not change with it.
  expect(handed!.quote.createdBy).toBe("user_a");
});

test("a quote can belong to nobody", async () => {
  const { ids, asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.update, { id, ownerId: null });
  expect((await asA.query(api.quotes.get, { id }))!.quote.ownerId).toBeUndefined();
});

test("a new version keeps the same owner", async () => {
  const { ids, asA } = await setup();
  const first = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.update, { id: first, ownerId: "user_charlie" });
  const second = await asA.mutation(api.quotes.newVersion, { id: first });
  expect((await asA.query(api.quotes.get, { id: second }))!.quote.ownerId).toBe("user_charlie");
});

// The name is the person, not a stamp on the row: a quote written before
// somebody named themselves should read as them once they have.
test("a quote written before its author had a name reads as them now", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.quotes.create, { title: "Docuseries" });
  expect((await asA.query(api.quotes.get, { id }))!.quote.producerName).toBeUndefined();

  await asA.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });
  expect((await asA.query(api.quotes.get, { id }))!.quote.producerName).toBe("Matt West");
});

test("a quote does not cross to another account", async () => {
  const { ids, asA, asB } = await setup();
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });

  expect(await asB.query(api.quotes.get, { id: quoteId })).toBeNull();
  expect(await asB.query(api.quotes.list, {})).toEqual([]);
  await expect(
    asB.mutation(api.quotes.update, { id: quoteId, number: "Mine now" })
  ).rejects.toThrow(/not found/i);
  await expect(
    asB.mutation(api.quotes.addLine, {
      quoteId,
      category: "pre",
      name: "Cheeky",
      unit: "day",
      costPence: 100,
    })
  ).rejects.toThrow(/not found/i);
});

test("signed out, quotes are neither readable nor writable", async () => {
  const { t, ids } = await setup();
  await expect(t.query(api.quotes.list, {})).rejects.toThrow(/authenticated/i);
  await expect(t.mutation(api.quotes.create, { projectId: ids.project })).rejects.toThrow(
    /authenticated/i
  );
});

test("the standard card carries every line of the sheet, under its own headings", async () => {
  // The card is what a producer prices from, so a chargeable line missing
  // from it is money left on the table. These are the sheet's own counts.
  const sections = new Map<string, number>();
  for (const item of RATE_CARD_SEED) {
    sections.set(item.section, (sections.get(item.section) ?? 0) + 1);
  }

  expect(RATE_CARD_SEED).toHaveLength(279);
  expect([...sections.keys()]).toEqual([
    "PRE - PRODUCTION",
    "PRE - PRODUCTION - CASTING",
    "PRODUCTION CREW",
    "ART DEPARTMENT / LOCATION",
    "PRODUCTION - CASTING",
    "EQUIPMENT",
    "CAMERAS",
    "LENSES",
    "ACCESSORIES",
    "GRIP",
    "MONITORING",
    "LIVESTREAM",
    "LIGHTING",
    "SOUND",
    "CONSUMABLES",
    "OTHER",
    "TRAVEL & HOTELS",
    "POST - PRODUCTION",
  ]);
  expect(sections.get("SOUND")).toBe(16);
  expect(sections.get("POST - PRODUCTION")).toBe(32);
  expect(sections.get("ART DEPARTMENT / LOCATION")).toBe(31);

  // Spot checks against the sheet, one per category, costs in pence.
  const find = (section: string, name: string) =>
    RATE_CARD_SEED.find((i) => i.section === section && i.name === name);
  expect(find("PRE - PRODUCTION", "Producer")?.costPence).toBe(48628);
  expect(find("SOUND", "Sennheiser MKH416")?.costPence).toBe(2909);
  expect(find("POST - PRODUCTION", "Colourist")?.costPence).toBe(62344);
  expect(find("TRAVEL & HOTELS", "Carnet")?.unit).toBe("trip");
  expect(find("POST - PRODUCTION", "Transcription")?.unit).toBe("minute");
  expect(find("POST - PRODUCTION", "Hard Drives")?.unit).toBe("item");
});

test("a new quote gets every line, with the sheet's sections on it", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const data = (await asA.query(api.quotes.get, { id }))!;

  expect(data.lines).toHaveLength(279);
  // The dividers are on the lines themselves, which is what the builder and
  // the client copy group by.
  expect(data.lines.some((l) => l.section === "SOUND")).toBe(true);
  expect(data.lines.some((l) => l.section === "CONSUMABLES")).toBe(true);
  expect(new Set(data.lines.map((l) => l.section)).size).toBe(18);
});

test("seeding a part-filled card adds only what is missing", async () => {
  const { asA } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  const before = await asA.query(api.rateCard.list, {});

  // Somebody has edited a cost and deleted a line they never charge for.
  const producer = before.find((i) => i.section === "PRE - PRODUCTION" && i.name === "Producer")!;
  await asA.mutation(api.rateCard.update, { id: producer._id, costPence: 99900 });
  const sound = before.find((i) => i.section === "SOUND")!;
  await asA.mutation(api.rateCard.remove, { id: sound._id });

  // Seeding again fills the gap rather than doubling the card up.
  expect((await asA.mutation(api.rateCard.seed, {})).added).toBe(1);

  const after = await asA.query(api.rateCard.list, {});
  expect(after).toHaveLength(279);
  expect(after.find((i) => i._id === producer._id)?.costPence).toBe(99900);
  // And again adds nothing at all.
  expect((await asA.mutation(api.rateCard.seed, {})).added).toBe(0);
});

test("a line added to the card late still reads in its section, not at the end", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });

  // Added long after the rest, exactly as a line restored to the card would
  // be: its sortOrder puts it last, its section says where it belongs.
  const line = await asA.mutation(api.quotes.addLine, {
    quoteId: id,
    category: "equipment",
    section: "CAMERAS",
    name: "Sony FX9 Camera",
    unit: "day",
    costPence: 10000,
  });

  const data = (await asA.query(api.quotes.get, { id }))!;
  const sections = data.lines.map((l) => l.section);
  const at = data.lines.findIndex((l) => l._id === line);
  // Inside the CAMERAS block — not after LENSES, and nowhere near the bottom.
  expect(sections[at]).toBe("CAMERAS");
  expect(sections.lastIndexOf("CAMERAS")).toBeLessThan(sections.indexOf("LENSES"));
  expect(at).toBeLessThan(data.lines.length - 1);
});

test("moving a line to another category takes it out of its old section", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const before = (await asA.query(api.quotes.get, { id }))!;
  const camera = before.lines.find((l) => l.section === "CAMERAS")!;

  await asA.mutation(api.quotes.updateLine, { id: camera._id, category: "post" });

  const after = (await asA.query(api.quotes.get, { id }))!;
  const moved = after.lines.find((l) => l._id === camera._id)!;
  expect(moved.category).toBe("post");
  // A camera printed under a CAMERAS heading inside Post Production is
  // nonsense, so the heading goes with the move.
  expect(moved.section).toBeUndefined();
});

test("a render token reads the quote, and only until it expires", async () => {
  const { asA, ids, t } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const { token } = await asA.mutation(api.quotes.createRenderToken, { id });

  // No login at all: the token is what the headless browser has.
  const seen = await t.query(api.quotes.getByRenderToken, { token });
  expect(seen?.quote._id).toBe(id);
  expect(seen?.lines.length).toBe(279);

  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("renderTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
  });
  expect(await t.query(api.quotes.getByRenderToken, { token })).toBeNull();
});

test("a call sheet's render token cannot be used to read a quote", async () => {
  const { asA, ids } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const { token } = await asA.mutation(api.quotes.createRenderToken, { id });
  // The other way round: a quote token is not a call sheet's to render.
  expect(await asA.query(api.callSheets.getByRenderToken, { token })).toBeNull();
});

test("sending the quote to the client marks it sent, once", async () => {
  const { asA, ids, t } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const fileId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["pdf"])));

  await asA.mutation(api.quotes.sendToClient, {
    id,
    to: "client@example.test",
    fileId,
    fileName: "quote.pdf",
  });

  const after = (await asA.query(api.quotes.get, { id }))!;
  expect(after.quote.status).toBe("sent");
  const issued = after.quote.issuedAt;
  expect(issued).toBeDefined();

  // Sent again — the date it first went out is the date it went out.
  await asA.mutation(api.quotes.sendToClient, {
    id,
    to: "client@example.test",
    fileId,
    fileName: "quote.pdf",
  });
  expect((await asA.query(api.quotes.get, { id }))!.quote.issuedAt).toBe(issued);
});

test("a quote is not sent to something that is not an address", async () => {
  const { asA, ids, t } = await setup();
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });
  const fileId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["pdf"])));
  await expect(
    asA.mutation(api.quotes.sendToClient, {
      id,
      to: "the client",
      fileId,
      fileName: "quote.pdf",
    })
  ).rejects.toThrow(/email address/i);
});

test("the standard card has no line twice", async () => {
  // A card is read by eye. Two rows with the same name in the same section
  // are indistinguishable in the list and a coin toss on the quote, so the
  // sheet's three — two told apart by a note, one a mislabelled row — are
  // named for what they are.
  const seen = new Map<string, number>();
  for (const item of RATE_CARD_SEED) {
    const key = `${item.section}::${item.name}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  expect([...seen.values()].filter((n) => n > 1)).toEqual([]);
  expect(seen.size).toBe(279);

  const grip = RATE_CARD_SEED.filter((i) => i.name.startsWith("Matthellini"));
  expect(grip.map((i) => i.name)).toEqual([
    "Matthellini Clamp (3” centre jaw)",
    "Matthellini Clamp (2” end jaw)",
  ]);
});

test("rebuilding the card makes it the standard card again", async () => {
  const { asA } = await setup();
  await asA.mutation(api.rateCard.seed, {});

  // A card that has drifted: rows from an older version of the standard list
  // under headings nothing matches any more, and an edited cost.
  await asA.mutation(api.rateCard.add, {
    category: "equipment",
    section: "EQUIPMENT - KIT FOR JOBS",
    name: "Sony FX9 Camera Kit",
    unit: "day",
    costPence: 22444,
  });
  const producer = (await asA.query(api.rateCard.list, {})).find(
    (i) => i.name === "Producer" && i.section === "PRE - PRODUCTION"
  )!;
  await asA.mutation(api.rateCard.update, { id: producer._id, costPence: 99900 });
  expect((await asA.query(api.rateCard.list, {})).length).toBe(280);

  const result = await asA.mutation(api.rateCard.rebuild, {});
  expect(result).toEqual({ removed: 280, added: 279 });

  const after = await asA.query(api.rateCard.list, {});
  expect(after).toHaveLength(279);
  expect(after.some((i) => i.section === "EQUIPMENT - KIT FOR JOBS")).toBe(false);
  // Deliberately not a merge: the edited cost goes with everything else, which
  // is what the confirmation says it will do.
  expect(after.find((i) => i.name === "Producer")?.costPence).toBe(48628);
});

test("rebuilding a quote's lines keeps what is priced and drops what is stale", async () => {
  const { asA, ids } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  const id = await asA.mutation(api.quotes.create, { projectId: ids.project });

  // Two lines from an older card: one priced onto the quote, one not.
  const stalePriced = await asA.mutation(api.quotes.addLine, {
    quoteId: id,
    category: "equipment",
    section: "EQUIPMENT - KIT FOR JOBS",
    name: "Sony FX9 Camera Kit",
    unit: "day",
    costPence: 22444,
  });
  await asA.mutation(api.quotes.updateLine, { id: stalePriced, pax: 1, unitAmount: 3 });
  await asA.mutation(api.quotes.addLine, {
    quoteId: id,
    category: "equipment",
    section: "EQUIPMENT - KIT FOR JOBS",
    name: "Gimbal Kit",
    unit: "day",
    costPence: 19950,
    // Nothing against it: on the quote in name only, which is what makes it
    // stale rather than somebody's work.
    pax: 0,
    unitAmount: 0,
  });
  // And one standard line deleted along the way.
  const before = (await asA.query(api.quotes.get, { id }))!;
  await asA.mutation(api.quotes.removeLine, {
    id: before.lines.find((l) => l.section === "SOUND")!._id,
  });

  const result = await asA.mutation(api.quotes.rebuildLines, { id });
  expect(result).toEqual({ removed: 1, added: 1 });

  const after = (await asA.query(api.quotes.get, { id }))!;
  // The priced one stays, whatever it is called: it is somebody's work, and
  // possibly a figure a client has already been shown.
  const kept = after.lines.find((l) => l._id === stalePriced)!;
  expect(kept.pax).toBe(1);
  expect(after.lines).toHaveLength(280);
  expect(after.lines.filter((l) => l.section === "EQUIPMENT - KIT FOR JOBS")).toHaveLength(1);
});

test("the card says what it holds that the standard one does not", async () => {
  const { asA } = await setup();
  await asA.mutation(api.rateCard.seed, {});

  // A card that has been seeded under one set of headings and topped up under
  // another: rows that match nothing, and a standard line gone missing.
  await asA.mutation(api.rateCard.add, {
    category: "equipment",
    section: "EQUIPMENT - KIT FOR JOBS",
    name: "Sony FX9 Camera Kit",
    unit: "day",
    costPence: 22444,
  });
  await asA.mutation(api.rateCard.add, {
    category: "production",
    section: "PRODUCTION CREW",
    name: "Hair & Make-Up",
    unit: "day",
    costPence: 48000,
  });
  const sound = (await asA.query(api.rateCard.list, {})).find((i) => i.section === "SOUND")!;
  await asA.mutation(api.rateCard.remove, { id: sound._id });

  const audit = await asA.query(api.rateCard.audit, {});
  expect(audit.total).toBe(280);
  expect(audit.standardTotal).toBe(279);
  expect(audit.extra.map((r) => r.name).sort()).toEqual([
    "Hair & Make-Up",
    "Sony FX9 Camera Kit",
  ]);
  expect(audit.missing).toHaveLength(1);

  // Removing the strays leaves the standard lines exactly as they are.
  expect((await asA.mutation(api.rateCard.removeNonStandard, {})).removed).toBe(2);
  const after = await asA.query(api.rateCard.audit, {});
  expect(after.extra).toEqual([]);
  expect(after.total).toBe(278);

  // And seeding puts the one that was deleted back, for 279 exactly.
  await asA.mutation(api.rateCard.seed, {});
  const settled = await asA.query(api.rateCard.audit, {});
  expect(settled).toMatchObject({ total: 279, extra: [], missing: [], duplicated: [] });
});

test("a second copy of a standard line counts as a stray", async () => {
  const { asA } = await setup();
  await asA.mutation(api.rateCard.seed, {});
  // Same section, same name, added twice: unreadable in the list and a coin
  // toss on a quote, whichever one a producer meant.
  await asA.mutation(api.rateCard.add, {
    category: "pre",
    section: "PRE - PRODUCTION",
    name: "Producer",
    unit: "day",
    costPence: 1,
  });
  expect((await asA.query(api.rateCard.audit, {})).duplicated).toEqual([
    { section: "PRE - PRODUCTION", name: "Producer" },
  ]);

  expect((await asA.mutation(api.rateCard.removeNonStandard, {})).removed).toBe(1);
  const after = await asA.query(api.rateCard.audit, {});
  expect(after.total).toBe(279);
  expect(after.duplicated).toEqual([]);
});

test("duplicating a quote copies its lines and figures into a new draft of its own", async () => {
  const { t, ids, asA, asCharlie } = await setup();
  const original = await asA.mutation(api.quotes.create, {
    projectId: ids.project,
    title: "Veeam launch",
  });
  await asA.mutation(api.quotes.addLine, {
    quoteId: original,
    category: "production",
    name: "Director",
    unit: "day",
    pax: 1,
    unitAmount: 2,
    costPence: p(500),
  });
  await asA.mutation(api.quotes.update, { id: original, status: "sent", discountPence: p(50) });
  await asA.mutation(api.quotes.setCategoryTotal, {
    quoteId: original,
    category: "production",
    totalPence: p(1500),
  });

  const copyId = await asCharlie.mutation(api.quotes.duplicate, { id: original });
  expect(copyId).not.toBe(original);

  const [source, copy] = await t.run(async (ctx) => [
    (await ctx.db.get(original))!,
    (await ctx.db.get(copyId))!,
  ]);
  expect(copy).toMatchObject({
    title: "Veeam launch (copy)",
    status: "draft",
    clientId: source.clientId,
    discountPence: p(50),
    profitBp: source.profitBp,
    createdBy: "user_charlie",
    ownerId: "user_charlie",
  });
  // A copy is for another job, and has not been sent to anyone.
  expect(copy.projectId).toBeUndefined();
  expect(copy.issuedAt).toBeUndefined();
  expect(copy.number).not.toBe(source.number);

  const [before, after] = await Promise.all([
    asA.query(api.quotes.get, { id: original }),
    asA.query(api.quotes.get, { id: copyId }),
  ]);
  expect(after!.totals).toEqual(before!.totals);

  // The original is untouched.
  expect(source.status).toBe("sent");
  expect(source.projectId).toBe(ids.project);
});

test("another org cannot duplicate your quote", async () => {
  const { asA, asB } = await setup();
  const id = await asA.mutation(api.quotes.create, { title: "Private" });
  await expect(asB.mutation(api.quotes.duplicate, { id })).rejects.toThrow();
});
