import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { CallSheetData, LocationEntry } from "./callSheetData";
import { sheetDraft } from "./sheetKey";

/**
 * What a call sheet prints about a location, taken from the location itself.
 * One place for it, so a generated sheet and an edited location agree.
 */
export function locationEntryFields(l: Doc<"locations">): Omit<LocationEntry, "id"> {
  return {
    locationId: l._id,
    name: l.name,
    address: l.address,
    lat: l.lat,
    lng: l.lng,
    plusCode: l.plusCode,
    parkingNotes: l.parkingNotes,
    accessNotes: l.accessNotes,
    nearestHospital: l.nearestHospital,
    satNav: l.satNav,
    nearestTube: l.nearestTube,
    nearestRail: l.nearestRail,
    // Only where neither station has been looked up separately yet.
    publicTransport:
      l.nearestTube || l.nearestRail ? undefined : (l.nearestStation ?? l.publicTransport),
    nearestPoliceStation: l.nearestPoliceStation,
    notes: l.notes,
  };
}

/** A sheet's locations with this one brought up to date; the same object when nothing changed. */
function withLocation(data: CallSheetData, location: Doc<"locations">): CallSheetData {
  const fields = locationEntryFields(location);
  let changed = false;
  const update = (entries: LocationEntry[]) =>
    entries.map((entry) => {
      if (entry.locationId !== location._id) return entry;
      const next: LocationEntry = { id: entry.id, ...fields };
      if (JSON.stringify(next) !== JSON.stringify(entry)) changed = true;
      return next;
    });
  const next: CallSheetData = {
    ...data,
    locations: update(data.locations),
    extraDays: data.extraDays?.map((day) => ({ ...day, locations: update(day.locations) })),
  };
  return changed ? next : data;
}

/**
 * Puts a location's current details onto every open call sheet draft that
 * prints it — each date's own sheet and the combined sheet.
 *
 * Parking, access, the stations and the rest are corrected on the location,
 * often after a sheet has been drafted, and a draft still showing the old
 * answer is how the wrong gate ends up on a sheet. Sent and saved versions
 * are left exactly as they went out.
 */
export async function syncLocationOntoDrafts(ctx: MutationCtx, location: Doc<"locations">) {
  // Productions that use the place: as their own location, or on a day.
  const projectIds = new Set<Id<"projects">>();
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", location.orgId))
    .take(2000);
  for (const project of projects) {
    if (project.locationId === location._id) projectIds.add(project._id);
  }
  const days = await ctx.db
    .query("shootDays")
    .withIndex("by_org", (q) => q.eq("orgId", location.orgId))
    .take(5000);
  for (const day of days) {
    if (day.locationIds.includes(location._id)) projectIds.add(day.projectId);
  }

  for (const projectId of projectIds) {
    const drafts: Doc<"callSheets">[] = [];
    for (const day of days.filter((d) => d.projectId === projectId)) {
      const draft = await sheetDraft(ctx, { shootDayId: day._id });
      if (draft) drafts.push(draft);
    }
    const combined = await sheetDraft(ctx, { combinedProjectId: projectId });
    if (combined) drafts.push(combined);

    for (const draft of drafts) {
      const data = withLocation(draft.data, location);
      if (data !== draft.data) await ctx.db.patch(draft._id, { data });
    }
  }
}
