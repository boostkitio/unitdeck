/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

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
  expect(a!.quote.number).toMatch(/^\d\d_Ala_QV1$/);
  expect(b!.quote.number).toMatch(/^\d\d_Ala_QV2$/);
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

test("moving a margin re-prices the quote but leaves pinned lines alone", async () => {
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
  const result = await asA.mutation(api.quotes.repriceLines, { quoteId });
  expect(result.repriced).toBe(1);

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  const byName = Object.fromEntries(loaded!.lines.map((l) => [l.name, l.ratePence]));
  expect(byName["Camera Op"]).toBe(p(445)); // 399 x 1.103 = 440.10, up to 445
  expect(byName["Archiving"]).toBe(p(150)); // pinned, untouched
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
  expect(loaded!.lines[0].costPence).toBe(p(399));
  expect(loaded!.lines[0].ratePence).toBe(p(480));
});

test("deleting a rate card line does not empty a quote that used it", async () => {
  const { ids, asA } = await setup();
  const itemId = await asA.mutation(api.rateCard.add, {
    category: "equipment",
    section: "EQUIPMENT",
    name: "Sony FX9 Camera Kit",
    unit: "day",
    costPence: p(224.44),
  });
  const quoteId = await asA.mutation(api.quotes.create, { projectId: ids.project });
  await asA.mutation(api.quotes.addFromRateCard, { quoteId, itemIds: [itemId] });
  await asA.mutation(api.rateCard.remove, { id: itemId });

  const loaded = await asA.query(api.quotes.get, { id: quoteId });
  expect(loaded!.lines).toHaveLength(1);
  expect(loaded!.lines[0].name).toBe("Sony FX9 Camera Kit");
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

test("the rate card seeds once and refuses to seed twice", async () => {
  const { asA } = await setup();
  const result = await asA.mutation(api.rateCard.seed, {});
  expect(result.added).toBeGreaterThan(200);

  const card = await asA.query(api.rateCard.list, {});
  expect(card.length).toBe(result.added);
  expect(card.some((i) => i.name === "Director of Photography")).toBe(true);
  expect(card.some((i) => i.name === "Sony FX9 Camera Kit")).toBe(true);

  await expect(asA.mutation(api.rateCard.seed, {})).rejects.toThrow(/already has lines/i);
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

// A line whose rate was typed must not move when the margins are touched.
test("a hand-typed rate survives a re-price", async () => {
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
  expect(loaded!.lines[0].ratePence).toBe(p(600));
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
  expect(loaded!.quote.number).toMatch(/^\d\d_Job_QV1$/);
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
