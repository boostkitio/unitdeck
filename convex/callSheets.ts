import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { callSheetDataValidator, CallSheetData, ContactSection } from "./lib/callSheetData";
import { contactsOf } from "./clients";
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

/**
 * A call sheet built from everything the production already knows.
 *
 * The point of keeping crew, talent, client, schedule, kit and location on the
 * project is that nobody should retype them into a call sheet. This reads the
 * lot for one shoot day and lays it out; what comes back is a starting draft,
 * still fully editable.
 */
async function buildFromProject(
  ctx: MutationCtx,
  org: Doc<"organisations">,
  day: Doc<"shootDays">
): Promise<CallSheetData> {
  const project = await ctx.db.get(day.projectId);
  if (!project) throw new Error("Project not found");
  const client = project.clientId ? await ctx.db.get(project.clientId) : null;

  // The day's own locations, falling back to the project's: a single-location
  // job is usually set up once, on the project.
  let locations = (await Promise.all(day.locationIds.map((id) => ctx.db.get(id)))).filter(
    (l): l is Doc<"locations"> => l !== null
  );
  if (locations.length === 0 && project.locationId) {
    const fallback = await ctx.db.get(project.locationId);
    if (fallback) locations = [fallback];
  }

  const schedule = await ctx.db
    .query("scheduleItems")
    .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
    .take(500);
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

  const crewRows = await ctx.db
    .query("projectCrew")
    .withIndex("by_project", (q) => q.eq("projectId", day.projectId))
    .take(300);
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

  // The first timed thing that happens is the call, unless nothing is timed.
  const generalCallTime = forToday.find((row) => row.time)?.time ?? "08:00";

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

  // The project's stored forecast is for one particular day; use it only when
  // that is this day, and fall back to whatever the day itself recorded.
  const forecast = project.forecast?.date === day.date ? project.forecast : null;
  const weatherSummary = forecast?.summary
    ? forecast.tempMinC !== undefined && forecast.tempMaxC !== undefined
      ? `${forecast.summary}, ${Math.round(forecast.tempMinC)}–${Math.round(forecast.tempMaxC)}°C`
      : forecast.summary
    : day.weather
      ? `${day.weather.summary}, ${Math.round(day.weather.tempMinC)}–${Math.round(day.weather.tempMaxC)}°C`
      : undefined;

  return {
    title: project.name,
    date: day.date,
    generalCallTime,
    productionCompany: org.name,
    clientName: client?.name,
    locations: locations.map((l, i) => ({
      id: `loc-${i + 1}`,
      locationId: l._id,
      name: l.name,
      address: l.address,
      lat: l.lat,
      lng: l.lng,
      plusCode: l.plusCode,
      parkingNotes: l.parkingNotes,
      nearestHospital: l.nearestHospital,
      satNav: l.satNav,
      publicTransport: l.nearestStation ?? l.publicTransport,
      nearestPoliceStation: l.nearestPoliceStation,
    })),
    schedule: forToday.map((row, i) => ({
      id: `sch-${i + 1}`,
      start: row.time ?? "",
      title: row.item,
      notes: row.notes,
    })),
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
    weatherSummary,
    sunrise: forecast?.sunrise ?? day.sun?.sunrise,
    sunset: forecast?.sunset ?? day.sun?.sunset,
    accommodation: day.accommodation,
  };
}

export const ensure = mutation({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org, day } = await requireShootDay(ctx, args.shootDayId);
    const existing = await getDraft(ctx, args.shootDayId);
    if (existing) return existing._id;

    return await ctx.db.insert("callSheets", {
      orgId: org._id,
      shootDayId: args.shootDayId,
      projectId: day.projectId,
      version: 1,
      status: "draft",
      data: await buildFromProject(ctx, org, day),
    });
  },
});

/**
 * Lay the production out onto a call sheet, now, from what it holds today.
 *
 * A draft that is already open is kept as a version rather than overwritten:
 * regenerating after adding three crew members should not cost the note
 * somebody typed into the old one.
 */
export const generateFromProject = mutation({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args): Promise<{ id: Id<"callSheets">; replacedDraft: boolean }> => {
    const { org, day } = await requireShootDay(ctx, args.shootDayId);
    const data = await buildFromProject(ctx, org, day);
    const draft = await getDraft(ctx, args.shootDayId);
    if (!draft) {
      const id = await ctx.db.insert("callSheets", {
        orgId: org._id,
        shootDayId: args.shootDayId,
        projectId: day.projectId,
        version: 1,
        status: "draft",
        data,
      });
      return { id, replacedDraft: false };
    }
    const id = await freezeAndInsertDraft(
      ctx,
      args.shootDayId,
      data,
      "Regenerated from the production"
    );
    return { id, replacedDraft: true };
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
