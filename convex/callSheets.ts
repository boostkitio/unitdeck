import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import {
  callSheetDataValidator,
  CallSheetData,
  ContactSection,
  Hotel,
  SheetDay,
} from "./lib/callSheetData";
import { contactsOf } from "./clients";
import { byCrewOrder } from "./lib/crewOrder";
import { locationEntryFields } from "./lib/sheetLocations";
import {
  requireSheetKey,
  sheetDraft,
  sheetVersions,
  type SheetKey,
} from "./lib/sheetKey";
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
  // A day's own draft: the highest version that is not a combined sheet.
  return await sheetDraft(ctx, { shootDayId });
}

/**
 * A call sheet built from everything the production already knows.
 *
 * The point of keeping crew, talent, client, schedule, kit and location on the
 * project is that nobody should retype them into a call sheet. This reads the
 * lot for one shoot day and lays it out; what comes back is a starting draft,
 * still fully editable.
 */
/**
 * What one date contributes to a sheet: where, when, and what happens.
 *
 * `prefix` keeps row ids unique when several dates share a sheet.
 */
async function dayParts(
  ctx: MutationCtx,
  project: Doc<"projects">,
  day: Doc<"shootDays">,
  schedule: Doc<"scheduleItems">[],
  prefix: string
): Promise<Omit<SheetDay, "id">> {
  // The day's own locations, falling back to the project's: a single-location
  // job is usually set up once, on the project.
  let locations = (await Promise.all(day.locationIds.map((id) => ctx.db.get(id)))).filter(
    (l): l is Doc<"locations"> => l !== null
  );
  if (locations.length === 0 && project.locationId) {
    const fallback = await ctx.db.get(project.locationId);
    if (fallback) locations = [fallback];
  }

  // This day's running order, plus anything not tied to a day, which applies
  // to the whole job and so applies to this one.
  const forToday = schedule
    .filter((row) => !row.shootDayId || row.shootDayId === day._id)
    .sort((a, b) => {
      if (a.time === b.time) return a.item.localeCompare(b.item);
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

  // Every day holds its own forecast. The project's older single forecast is
  // only a fallback, and only for the one date it was fetched for.
  const forecast = project.forecast?.date === day.date ? project.forecast : null;
  const weatherSummary = day.weather
    ? `${day.weather.summary}, ${Math.round(day.weather.tempMinC)}–${Math.round(day.weather.tempMaxC)}°C`
    : forecast?.summary
      ? forecast.tempMinC !== undefined && forecast.tempMaxC !== undefined
        ? `${forecast.summary}, ${Math.round(forecast.tempMinC)}–${Math.round(forecast.tempMaxC)}°C`
        : forecast.summary
      : undefined;

  return {
    shootDayId: day._id,
    date: day.date,
    label: day.label,
    // The first timed thing that happens is the call, unless nothing is timed.
    generalCallTime: forToday.find((row) => row.time)?.time ?? "08:00",
    locations: locations.map((l, i) => ({
      id: `${prefix}loc-${i + 1}`,
      ...locationEntryFields(l),
    })),
    schedule: forToday.map((row, i) => ({
      id: `${prefix}sch-${i + 1}`,
      start: row.time ?? "",
      title: row.item,
      notes: row.notes,
    })),
    weatherSummary,
    sunrise: day.sun?.sunrise ?? forecast?.sunrise,
    sunset: day.sun?.sunset ?? forecast?.sunset,
  };
}

/**
 * `extraDays` makes it a combined sheet: those dates are printed after the
 * first, each with its own call, running order and location, while the
 * people, kit and hotels — which belong to the production — are printed once.
 */
async function buildFromProject(
  ctx: MutationCtx,
  org: Doc<"organisations">,
  day: Doc<"shootDays">,
  extraDays: Doc<"shootDays">[] = []
): Promise<CallSheetData> {
  const project = await ctx.db.get(day.projectId);
  if (!project) throw new Error("Project not found");
  const client = project.clientId ? await ctx.db.get(project.clientId) : null;

  const schedule = await ctx.db
    .query("scheduleItems")
    .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
    .take(500);
  const first = await dayParts(ctx, project, day, schedule, "");
  const extras: SheetDay[] = [];
  for (const [i, extra] of extraDays.entries()) {
    const prefix = `d${i + 2}-`;
    extras.push({ id: `${prefix}day`, ...(await dayParts(ctx, project, extra, schedule, prefix)) });
  }

  // In the order the production's crew list is arranged in — director first,
  // camera together — not the order people happened to be booked.
  const crewRows = (
    await ctx.db
      .query("projectCrew")
      .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
      .take(300)
  ).sort(byCrewOrder);
  const people = new Map<string, Doc<"people">>();
  for (const row of crewRows) {
    if (!row.personId || people.has(String(row.personId))) continue;
    const person = await ctx.db.get(row.personId);
    if (person) people.set(String(row.personId), person);
  }

  const kit = await ctx.db
    .query("projectEquipment")
    .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
    .take(500);

  const logoUrl = org.settings?.logoStorageId
    ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
    : undefined;

  const generalCallTime = first.generalCallTime;

  const stays = (
    await ctx.db
      .query("accommodation")
      .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
      .take(100)
  ).filter((row) => row.orgId === org._id);
  const hotels: Hotel[] = stays.map((stay, i) => ({
    id: `hotel-${i + 1}`,
    name: stay.name,
    address: stay.address,
    phone: stay.phone,
    checkIn: stay.checkIn,
    nights: stay.nights,
    bookingRef: stay.bookingRef,
    notes: stay.notes,
  }));
  // A hotel still held on the day itself, from before accommodation moved to
  // the production, rather than a sheet that says nobody is staying over.
  if (hotels.length === 0 && day.accommodation) {
    hotels.push({ id: "hotel-1", ...day.accommodation });
  }

  const named = (row: Doc<"projectCrew">) => {
    const person = row.personId ? people.get(String(row.personId)) : undefined;
    return {
      person,
      name: person?.name ?? "TO BOOK",
      role: row.role?.trim() || person?.role || "Crew",
    };
  };

  const crew = crewRows
    .filter((row) => (row.kind ?? "crew") === "crew")
    .map((row, i) => {
      const { person, name, role } = named(row);
      return {
        id: `crew-${i + 1}`,
        personId: row.personId,
        name,
        role,
        callTime: generalCallTime,
        phone: person?.phone,
        email: person?.email,
        notes: row.notes,
      };
    });

  const talent = crewRows
    .filter((row) => row.kind === "talent")
    .map((row, i) => {
      const { person, name, role } = named(row);
      return {
        id: `talent-${i + 1}`,
        personId: row.personId,
        name,
        role,
        callTime: generalCallTime,
        phone: person?.phone,
        email: person?.email,
        notes: row.notes,
      };
    });

  // Only the people actually on this production: a client's accounts contact
  // does not belong on a call sheet.
  const everyone = client ? contactsOf(client) : [];
  const bookings = client
    ? (
        await ctx.db
          .query("projectClients")
          .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
          .take(200)
      ).filter((r) => r.clientId === client._id)
    : [];
  const booked = new Set(bookings.map((r) => r.contactId));
  const onShoot = project.clientContactsChosen
    ? everyone.filter((c) => c.id !== undefined && booked.has(c.id))
    : everyone;
  const clientRows = onShoot.map((contact, i) => ({
    id: `client-${i + 1}`,
    name: contact.name,
    role: contact.role ?? "Client",
    phone: contact.phone,
    email: contact.email,
  }));

  const contactSections: ContactSection[] = [];
  if (talent.length > 0) contactSections.push({ id: "sec-talent", title: "Talent", rows: talent });
  if (clientRows.length > 0) {
    contactSections.push({ id: "sec-client", title: "Client", rows: clientRows });
  }

  return {
    title: project.name,
    date: first.date,
    dayLabel: extras.length > 0 ? first.label : undefined,
    generalCallTime,
    productionCompany: org.name,
    clientName: client?.name,
    locations: first.locations,
    schedule: first.schedule,
    crew,
    contacts: [],
    crewSectionTitle: "Crew",
    contactSections,
    callTimes: [{ id: "ct-crew", label: "Crew call", time: generalCallTime }],
    equipment: kit.map((row, i) => ({
      id: `kit-${i + 1}`,
      // The hire-ins are what a call sheet needs to name a supplier for; own
      // kit is filed under its department instead.
      supplier: row.section === "additional" ? "Hired in" : row.dept,
      item: row.quantity && row.quantity > 1 ? `${row.quantity} × ${row.item}` : row.item,
    })),
    notes: project.briefSummary,
    branding:
      org.settings?.brandColor || logoUrl
        ? { brandColor: org.settings?.brandColor, logoUrl }
        : undefined,
    invoicing: org.settings?.invoicing,
    confidential: org.settings?.confidentialByDefault,
    weatherSummary: first.weatherSummary,
    sunrise: first.sunrise,
    sunset: first.sunset,
    hotels,
    extraDays: extras.length > 0 ? extras : undefined,
  };
}

/**
 * Puts freshly built data onto a sheet, keeping any open draft as a version.
 * `anchor` is the day a new row is filed under: the day itself, or a combined
 * sheet's earliest date.
 */
async function writeGenerated(
  ctx: MutationCtx,
  org: Doc<"organisations">,
  key: SheetKey,
  anchor: Doc<"shootDays">,
  data: CallSheetData,
  note: string
): Promise<{ id: Id<"callSheets">; replacedDraft: boolean }> {
  const draft = await sheetDraft(ctx, key);
  if (!draft) {
    const [latest] = await sheetVersions(ctx, key, 1);
    const id = await ctx.db.insert("callSheets", {
      orgId: org._id,
      shootDayId: anchor._id,
      projectId: anchor.projectId,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      data,
      combined: "combinedProjectId" in key ? true : undefined,
    });
    return { id, replacedDraft: false };
  }
  const id = await freezeAndInsertDraft(ctx, key, data, note, anchor._id);
  return { id, replacedDraft: true };
}

export const ensure = mutation({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org, day } = await requireShootDay(ctx, args.shootDayId);
    const existing = await getDraft(ctx, args.shootDayId);
    if (existing) return existing._id;
    const { id } = await writeGenerated(
      ctx,
      org,
      { shootDayId: day._id },
      day,
      await buildFromProject(ctx, org, day),
      ""
    );
    return id;
  },
});

/**
 * Lay the production out onto one day's call sheet, now, from what it holds
 * today.
 *
 * A draft that is already open is kept as a version rather than overwritten:
 * regenerating after adding three crew members should not cost the note
 * somebody typed into the old one. Always a one-day sheet: combining dates is
 * the combined sheet's job, and does not touch this one.
 */
export const generateFromProject = mutation({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args): Promise<{ id: Id<"callSheets">; replacedDraft: boolean }> => {
    const { org, day } = await requireShootDay(ctx, args.shootDayId);
    const data = await buildFromProject(ctx, org, day);
    return await writeGenerated(
      ctx,
      org,
      { shootDayId: day._id },
      day,
      data,
      "Regenerated from the production"
    );
  },
});

/**
 * One call sheet for several dates: the production's combined sheet.
 *
 * It is a document of its own, beside each date's own sheet, and there is one
 * per production — generating it again with different dates makes a new
 * version of the same sheet. It is filed under its earliest date so it can be
 * sent and checked like any other.
 */
export const generateCombined = mutation({
  args: { shootDayIds: v.array(v.id("shootDays")) },
  handler: async (
    ctx,
    args
  ): Promise<{ id: Id<"callSheets">; projectId: Id<"projects">; replacedDraft: boolean }> => {
    const { org } = await requireOrg(ctx);
    const unique = [...new Set(args.shootDayIds)];
    if (unique.length < 2) throw new Error("Pick at least two dates to combine");
    if (unique.length > 31) throw new Error("A combined call sheet can cover up to 31 dates");

    const days: Doc<"shootDays">[] = [];
    for (const id of unique) {
      const day = await ctx.db.get(id);
      if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
      days.push(day);
    }
    if (days.some((d) => d.projectId !== days[0].projectId)) {
      throw new Error("Only dates on the same production can be combined");
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    const [anchor, ...rest] = days;
    const data = await buildFromProject(ctx, org, anchor, rest);
    const result = await writeGenerated(
      ctx,
      org,
      { combinedProjectId: anchor.projectId },
      anchor,
      data,
      `Regenerated for ${days.length} dates`
    );
    return { ...result, projectId: anchor.projectId };
  },
});

/**
 * The production's combined call sheet, summarised for the Call sheet
 * section: which dates it covers and which version it is on. Null when none
 * has been generated.
 */
export const combinedForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return null;
    const [latest] = await sheetVersions(ctx, { combinedProjectId: args.projectId }, 1);
    if (!latest) return null;
    const shootDayIds = [
      latest.shootDayId,
      ...(latest.data.extraDays ?? [])
        .map((extra) => extra.shootDayId)
        .filter((id): id is Id<"shootDays"> => id !== undefined),
    ];
    return {
      id: latest._id,
      version: latest.version,
      dates: [latest.data.date, ...(latest.data.extraDays ?? []).map((extra) => extra.date)],
      shootDayIds,
    };
  },
});

export const getCurrent = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    await requireShootDay(ctx, args.shootDayId);
    return await getDraft(ctx, args.shootDayId);
  },
});

export const getCurrentCombined = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const key = { combinedProjectId: args.projectId };
    await requireSheetKey(ctx, key);
    return await sheetDraft(ctx, key);
  },
});

async function versionList(ctx: QueryCtx, key: SheetKey) {
  await requireSheetKey(ctx, key);
  const versions = await sheetVersions(ctx, key, 100);
  // History list never needs full document bodies
  return versions.map(({ _id, version, status, versionNote, _creationTime }) => ({
    _id,
    version,
    status,
    versionNote,
    _creationTime,
  }));
}

export const listVersions = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => await versionList(ctx, { shootDayId: args.shootDayId }),
});

export const listCombinedVersions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => await versionList(ctx, { combinedProjectId: args.projectId }),
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
  key: SheetKey,
  data: CallSheetData,
  note?: string,
  anchorDayId?: Id<"shootDays">
) {
  const draft = await sheetDraft(ctx, key);
  if (!draft) throw new Error("No draft to version");
  await ctx.db.patch(draft._id, { status: "snapshot", versionNote: note });
  return await ctx.db.insert("callSheets", {
    orgId: draft.orgId,
    shootDayId: anchorDayId ?? draft.shootDayId,
    projectId: draft.projectId,
    version: draft.version + 1,
    status: "draft",
    data,
    combined: draft.combined,
  });
}

async function snapshot(ctx: MutationCtx, key: SheetKey, note: string | undefined) {
  await requireSheetKey(ctx, key);
  const draft = await sheetDraft(ctx, key);
  if (!draft) throw new Error("No draft to version");
  return await freezeAndInsertDraft(ctx, key, draft.data, note);
}

export const snapshotVersion = mutation({
  args: { shootDayId: v.id("shootDays"), note: v.optional(v.string()) },
  handler: async (ctx, args) => await snapshot(ctx, { shootDayId: args.shootDayId }, args.note),
});

export const snapshotCombined = mutation({
  args: { projectId: v.id("projects"), note: v.optional(v.string()) },
  handler: async (ctx, args) =>
    await snapshot(ctx, { combinedProjectId: args.projectId }, args.note),
});

async function restore(ctx: MutationCtx, key: SheetKey, fromId: Id<"callSheets">) {
  const { org } = await requireSheetKey(ctx, key);
  const from = await ctx.db.get(fromId);
  const belongs =
    from !== null &&
    from.orgId === org._id &&
    ("combinedProjectId" in key
      ? from.combined === true && from.projectId === key.combinedProjectId
      : !from.combined && from.shootDayId === key.shootDayId);
  if (!from || !belongs) throw new Error("Version not found");
  return await freezeAndInsertDraft(ctx, key, from.data, `Restored from v${from.version}`, from.shootDayId);
}

export const restoreVersion = mutation({
  args: { shootDayId: v.id("shootDays"), fromId: v.id("callSheets") },
  handler: async (ctx, args) => await restore(ctx, { shootDayId: args.shootDayId }, args.fromId),
});

export const restoreCombined = mutation({
  args: { projectId: v.id("projects"), fromId: v.id("callSheets") },
  handler: async (ctx, args) =>
    await restore(ctx, { combinedProjectId: args.projectId }, args.fromId),
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
    // A token minted for a quote is not this one's to render.
    if (!row.callSheetId) return null;
    const sheet = await ctx.db.get(row.callSheetId);
    if (!sheet) return null;
    return { data: sheet.data, version: sheet.version };
  },
});

/**
 * Delete expired render tokens (reads already treat them as gone). Called by
 * the daily cron; the batch bound keeps a single run cheap and any backlog
 * drains across consecutive days.
 */
export const cleanupExpiredRenderTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("renderTokens")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return null;
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
