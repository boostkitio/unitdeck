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
    shootDayId: day._id,
    date: day.date,
    label: day.label,
    // The first timed thing that happens is the call, unless nothing is timed.
    generalCallTime: forToday.find((row) => row.time)?.time ?? "08:00",
    locations: locations.map((l, i) => ({
      id: `${prefix}loc-${i + 1}`,
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
      id: `${prefix}sch-${i + 1}`,
      start: row.time ?? "",
      title: row.item,
      notes: row.notes,
    })),
    weatherSummary,
    sunrise: forecast?.sunrise ?? day.sun?.sunrise,
    sunset: forecast?.sunset ?? day.sun?.sunset,
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

/** The other dates a draft already covers, so regenerating it keeps them. */
async function daysAlreadyCombined(
  ctx: MutationCtx,
  anchor: Doc<"shootDays">,
  draft: Doc<"callSheets"> | null
): Promise<Doc<"shootDays">[]> {
  const out: Doc<"shootDays">[] = [];
  for (const extra of draft?.data.extraDays ?? []) {
    if (!extra.shootDayId || extra.shootDayId === anchor._id) continue;
    const day = await ctx.db.get(extra.shootDayId);
    // A date deleted from the production since drops off the sheet with it.
    if (day && day.projectId === anchor.projectId) out.push(day);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Puts freshly built data onto a day's sheet, keeping any open draft as a version. */
async function writeGenerated(
  ctx: MutationCtx,
  org: Doc<"organisations">,
  day: Doc<"shootDays">,
  data: CallSheetData,
  note: string
): Promise<{ id: Id<"callSheets">; replacedDraft: boolean }> {
  const draft = await getDraft(ctx, day._id);
  if (!draft) {
    const id = await ctx.db.insert("callSheets", {
      orgId: org._id,
      shootDayId: day._id,
      projectId: day.projectId,
      version: 1,
      status: "draft",
      data,
    });
    return { id, replacedDraft: false };
  }
  const id = await freezeAndInsertDraft(ctx, day._id, data, note);
  return { id, replacedDraft: true };
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
    // A combined sheet regenerates as a combined sheet: the dates on it were
    // chosen, and refreshing the crew should not quietly drop them.
    const extras = await daysAlreadyCombined(ctx, day, await getDraft(ctx, day._id));
    const data = await buildFromProject(ctx, org, day, extras);
    return await writeGenerated(ctx, org, day, data, "Regenerated from the production");
  },
});

/**
 * One call sheet for several dates.
 *
 * It lives on the earliest of them, so its versions, recipients, checks and
 * PDF work exactly as a one-day sheet's do. The other dates keep their own
 * sheets; this one simply prints them all.
 */
export const generateCombined = mutation({
  args: { shootDayIds: v.array(v.id("shootDays")) },
  handler: async (
    ctx,
    args
  ): Promise<{ id: Id<"callSheets">; shootDayId: Id<"shootDays">; replacedDraft: boolean }> => {
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
      anchor,
      data,
      `Combined with ${rest.length} more date${rest.length === 1 ? "" : "s"}`
    );
    return { ...result, shootDayId: anchor._id };
  },
});

/**
 * Which dates on a production are printed on another date's combined sheet,
 * so the list of dates can say where to find them.
 */
export const combinedForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const out: { shootDayId: Id<"shootDays">; coversDayIds: Id<"shootDays">[] }[] = [];
    for (const day of days) {
      const draft = await getDraft(ctx, day._id);
      const covers = (draft?.data.extraDays ?? [])
        .map((extra) => extra.shootDayId)
        .filter((id): id is Id<"shootDays"> => id !== undefined);
      if (covers.length > 0) out.push({ shootDayId: day._id, coversDayIds: covers });
    }
    return out;
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
