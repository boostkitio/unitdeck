import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { callSheetDataValidator, CallSheetData } from "./lib/callSheetData";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const TOKEN_TTL_MS = 10 * 60 * 1000; // render links live 10 minutes

async function requireShootDay(ctx: QueryCtx | MutationCtx, shootDayId: Id<"shootDays">) {
  const { org } = await requireOrg(ctx);
  const day = await ctx.db.get(shootDayId);
  if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
  return { org, day };
}

async function getDraft(ctx: QueryCtx | MutationCtx, shootDayId: Id<"shootDays">) {
  // The draft is always the highest version row
  const latest = await ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", shootDayId))
    .order("desc")
    .first();
  return latest?.status === "draft" ? latest : null;
}

export const ensure = mutation({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org, day } = await requireShootDay(ctx, args.shootDayId);
    const existing = await getDraft(ctx, args.shootDayId);
    if (existing) return existing._id;

    const project = await ctx.db.get(day.projectId);
    if (!project) throw new Error("Project not found");
    const client = project.clientId ? await ctx.db.get(project.clientId) : null;
    const locations = (
      await Promise.all(day.locationIds.map((id) => ctx.db.get(id)))
    ).filter((l): l is Doc<"locations"> => l !== null);

    const data: CallSheetData = {
      title: project.name,
      date: day.date,
      generalCallTime: "08:00",
      productionCompany: org.name,
      clientName: client?.name,
      locations: locations.map((l, i) => ({
        id: `loc-${i + 1}`,
        locationId: l._id,
        name: l.name,
        address: l.address,
        w3w: l.w3w,
        parkingNotes: l.parkingNotes,
        nearestHospital: l.nearestHospital,
      })),
      schedule: [],
      crew: [],
      contacts: [],
      weatherSummary: day.weather
        ? `${day.weather.summary}, ${Math.round(day.weather.tempMinC)}–${Math.round(day.weather.tempMaxC)}°C`
        : undefined,
      sunrise: day.sun?.sunrise,
      sunset: day.sun?.sunset,
    };

    return await ctx.db.insert("callSheets", {
      orgId: org._id,
      shootDayId: args.shootDayId,
      projectId: day.projectId,
      version: 1,
      status: "draft",
      data,
    });
  },
});

export const getCurrent = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    await requireShootDay(ctx, args.shootDayId);
    return await getDraft(ctx, args.shootDayId);
  },
});

export const listVersions = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    await requireShootDay(ctx, args.shootDayId);
    const versions = await ctx.db
      .query("callSheets")
      .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", args.shootDayId))
      .order("desc")
      .take(100);
    // History list never needs full document bodies
    return versions.map(({ _id, version, status, versionNote, _creationTime }) => ({
      _id,
      version,
      status,
      versionNote,
      _creationTime,
    }));
  },
});

export const saveDraft = mutation({
  args: { id: v.id("callSheets"), data: callSheetDataValidator },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const sheet = await ctx.db.get(args.id);
    if (!sheet || sheet.orgId !== org._id) throw new Error("Call sheet not found");
    if (sheet.status !== "draft") throw new Error("Only the draft can be edited");
    await ctx.db.patch(args.id, { data: args.data });
    return null;
  },
});

async function freezeAndInsertDraft(
  ctx: MutationCtx,
  shootDayId: Id<"shootDays">,
  data: CallSheetData,
  note?: string
) {
  const draft = await getDraft(ctx, shootDayId);
  if (!draft) throw new Error("No draft to version");
  await ctx.db.patch(draft._id, { status: "snapshot", versionNote: note });
  return await ctx.db.insert("callSheets", {
    orgId: draft.orgId,
    shootDayId,
    projectId: draft.projectId,
    version: draft.version + 1,
    status: "draft",
    data,
  });
}

export const snapshotVersion = mutation({
  args: { shootDayId: v.id("shootDays"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireShootDay(ctx, args.shootDayId);
    const draft = await getDraft(ctx, args.shootDayId);
    if (!draft) throw new Error("No draft to version");
    return await freezeAndInsertDraft(ctx, args.shootDayId, draft.data, args.note);
  },
});

export const restoreVersion = mutation({
  args: { shootDayId: v.id("shootDays"), fromId: v.id("callSheets") },
  handler: async (ctx, args) => {
    const { org } = await requireShootDay(ctx, args.shootDayId);
    const from = await ctx.db.get(args.fromId);
    if (!from || from.orgId !== org._id || from.shootDayId !== args.shootDayId) {
      throw new Error("Version not found");
    }
    return await freezeAndInsertDraft(
      ctx,
      args.shootDayId,
      from.data,
      `Restored from v${from.version}`
    );
  },
});

export const getVersion = query({
  args: { id: v.id("callSheets") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const sheet = await ctx.db.get(args.id);
    if (!sheet || sheet.orgId !== org._id) return null;
    return sheet;
  },
});

export const createRenderToken = mutation({
  args: { id: v.id("callSheets") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const sheet = await ctx.db.get(args.id);
    if (!sheet || sheet.orgId !== org._id) throw new Error("Call sheet not found");
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await ctx.db.insert("renderTokens", {
      callSheetId: args.id,
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return { token };
  },
});

/**
 * Public by token: the print page (and only the print page) loads call sheet
 * data this way. Tokens are unguessable, single-purpose and short-lived.
 */
export const getByRenderToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("renderTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row || row.expiresAt < Date.now()) return null;
    const sheet = await ctx.db.get(row.callSheetId);
    if (!sheet) return null;
    return { data: sheet.data, version: sheet.version };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachPdf = mutation({
  args: { id: v.id("callSheets"), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const sheet = await ctx.db.get(args.id);
    if (!sheet || sheet.orgId !== org._id) throw new Error("Call sheet not found");
    await ctx.db.patch(args.id, { pdfFileId: args.fileId });
    return null;
  },
});
