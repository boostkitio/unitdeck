import { mutation, query, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { byCrewOrder } from "./lib/crewOrder";
import { Doc, Id } from "./_generated/dataModel";

export type CrewStatus = "pencilled" | "confirmed";

export type ProjectCrewMember = {
  _id: Id<"projectCrew">;
  // Null on a role nobody has been booked into yet.
  personId: Id<"people"> | null;
  name: string | null;
  // The project role when one was set, otherwise the person's default role.
  role: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: CrewStatus;
  /** Talent and crew are booked the same way; this says which list it is in. */
  kind: "crew" | "talent";
  /** Somebody is in the role, whether or not they are in People. */
  booked: boolean;
  /** Their details come from a People (or Talent) record rather than the booking. */
  inPeople: boolean;
};

const crewStatusValidator = v.union(v.literal("pencilled"), v.literal("confirmed"));

/**
 * Crew booked onto a project, with contact details resolved from `people`.
 * Bookings whose person has been deleted outright are skipped; archived people
 * still show, because removing someone from the contact book should not
 * silently empty a production's crew list.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<ProjectCrewMember[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    const bookings = (
      await ctx.db
        .query("projectCrew")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .take(200)
    ).sort(byCrewOrder);

    const members: ProjectCrewMember[] = [];
    for (const booking of bookings) {
      // No person record: a role nobody is in yet, or somebody on this
      // production only, whose details are on the booking.
      if (booking.personId === undefined) {
        const name = booking.name?.trim() || null;
        members.push({
          _id: booking._id,
          personId: null,
          name,
          role: booking.role ?? (booking.kind === "talent" ? "Talent" : "Crew"),
          email: name ? (booking.email ?? null) : null,
          phone: name ? (booking.phone ?? null) : null,
          notes: booking.notes ?? null,
          status: booking.status ?? "pencilled",
          kind: booking.kind ?? "crew",
          booked: name !== null,
          inPeople: false,
        });
        continue;
      }
      const person: Doc<"people"> | null = await ctx.db.get(booking.personId);
      if (!person || person.orgId !== org._id) continue;
      members.push({
        _id: booking._id,
        personId: person._id,
        name: person.name,
        role: booking.role ?? person.role,
        email: person.email ?? null,
        phone: person.phone ?? null,
        notes: booking.notes ?? null,
        // Bookings made before the field existed are pencilled, not confirmed.
        status: booking.status ?? "pencilled",
        kind: booking.kind ?? "crew",
        booked: true,
        inPeople: true,
      });
    }
    // Nothing re-sorts here. The bookings were read in the arranged order and
    // that is the order they go out in — an alphabetical pass at this point
    // threw the arrangement away, so dragging somebody up wrote a sortOrder
    // that was never read back and the row sprang straight to where it was.
    return members;
  },
});

/**
 * Books someone onto a project, or adds a role with nobody in it yet so the
 * gap is visible until it is filled.
 */

/**
 * Bring this production's staff calendar entries back in line.
 *
 * Every mutation that changes who is booked, or how, says so — the sync then
 * works the whole production out again rather than trying to translate one
 * change into one calendar write. It does nothing at all unless the
 * organisation has calendar sync switched on.
 */
async function syncCalendar(ctx: MutationCtx, projectId: Id<"projects">) {
  await ctx.scheduler.runAfter(0, internal.calendarSync.reconcileProject, { projectId });
}

export const add = mutation({
  args: {
    projectId: v.id("projects"),
    personId: v.optional(v.id("people")),
    role: v.optional(v.string()),
    notes: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("crew"), v.literal("talent"))),
    // Somebody for this production only, not saved to People. Ignored when
    // `personId` is given.
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    if (args.personId === undefined && args.name?.trim()) {
      const booked = await ctx.db.insert("projectCrew", {
        orgId: org._id,
        projectId: args.projectId,
        name: args.name.trim(),
        email: args.email?.trim() || undefined,
        phone: args.phone?.trim() || undefined,
        role: args.role?.trim() || undefined,
        notes: args.notes?.trim() || undefined,
        status: "pencilled",
        kind: args.kind,
      });
      await syncCalendar(ctx, args.projectId);
      return booked;
    }

    if (args.personId === undefined) {
      // Nothing else names the row, so the role has to be there.
      if (!args.role?.trim()) throw new Error("Name the role you need to fill");
      // Nobody is in it yet, so there is nothing to put on a calendar — but
      // the sync is harmless and keeps one rule rather than two.
      const unfilled = await ctx.db.insert("projectCrew", {
        orgId: org._id,
        projectId: args.projectId,
        role: args.role.trim(),
        notes: args.notes?.trim() || undefined,
        status: "pencilled",
        kind: args.kind,
      });
      await syncCalendar(ctx, args.projectId);
      return unfilled;
    }

    const person = await ctx.db.get(args.personId);
    if (!person || person.orgId !== org._id) throw new Error("Person not found");

    // One booking per person per project.
    const existing = await ctx.db
      .query("projectCrew")
      .withIndex("by_project_and_person", (q) =>
        q.eq("projectId", args.projectId).eq("personId", args.personId)
      )
      .unique();
    if (existing) throw new Error(`${person.name} is already on this project`);

    const booked = await ctx.db.insert("projectCrew", {
      orgId: org._id,
      projectId: args.projectId,
      personId: args.personId,
      role: args.role?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      status: "pencilled",
      kind: args.kind,
    });
    await syncCalendar(ctx, args.projectId);
    return booked;
  },
});

/** Puts someone into a role that was waiting to be filled. */
export const assign = mutation({
  args: { id: v.id("projectCrew"), personId: v.id("people") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking || booking.orgId !== org._id) throw new Error("Role not found");
    const person = await ctx.db.get(args.personId);
    if (!person || person.orgId !== org._id) throw new Error("Person not found");

    const clash = await ctx.db
      .query("projectCrew")
      .withIndex("by_project_and_person", (q) =>
        q.eq("projectId", booking.projectId).eq("personId", args.personId)
      )
      .unique();
    if (clash) throw new Error(`${person.name} is already on this project`);

    // The role stays as typed — that is what the slot was created for. The
    // person record now holds the details, so the booking's own copy goes.
    await ctx.db.patch(args.id, {
      personId: args.personId,
      name: undefined,
      email: undefined,
      phone: undefined,
    });
    await syncCalendar(ctx, booking.projectId);
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("projectCrew"),
    role: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    status: v.optional(crewStatusValidator),
    kind: v.optional(v.union(v.literal("crew"), v.literal("talent"))),
    // Details of somebody on this production only. Somebody in People is
    // edited on their People record instead.
    name: v.optional(v.string()),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking || booking.orgId !== org._id) throw new Error("Crew member not found");

    const patch: Partial<Doc<"projectCrew">> = {};
    if (args.name !== undefined || args.email !== undefined || args.phone !== undefined) {
      if (booking.personId !== undefined) {
        throw new Error("Their details are on their People record — edit them there");
      }
      if (args.name !== undefined) {
        if (!args.name.trim()) throw new Error("A name is required");
        patch.name = args.name.trim();
      }
      if (args.email !== undefined) patch.email = args.email?.trim() || undefined;
      if (args.phone !== undefined) patch.phone = args.phone?.trim() || undefined;
    }
    // null clears the override and falls back to the person's default role.
    if (args.role !== undefined) patch.role = args.role?.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    // Moves a booking between the crew list and the talent list.
    if (args.kind !== undefined) patch.kind = args.kind;

    await ctx.db.patch(args.id, patch);
    await syncCalendar(ctx, booking.projectId);
    return null;
  },
});

/**
 * Saves somebody booked on this production only into People — or Talent, for
 * talent — so they can be picked for the next job, and links the booking to
 * the new record.
 */
export const saveToPeople = mutation({
  args: { id: v.id("projectCrew") },
  handler: async (ctx, args): Promise<Id<"people">> => {
    const { org } = await requireOrg(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking || booking.orgId !== org._id) throw new Error("Crew member not found");
    if (booking.personId !== undefined) throw new Error("Already in People");
    const name = booking.name?.trim();
    if (!name) throw new Error("Book somebody into this role first");

    const kind = booking.kind ?? "crew";
    const personId = await ctx.db.insert("people", {
      orgId: org._id,
      name,
      kind,
      role: booking.role?.trim() || (kind === "talent" ? "Talent" : "Crew"),
      email: booking.email,
      phone: booking.phone,
    });
    await ctx.db.patch(args.id, {
      personId,
      name: undefined,
      email: undefined,
      phone: undefined,
    });
    await syncCalendar(ctx, booking.projectId);
    return personId;
  },
});

export const remove = mutation({
  args: { id: v.id("projectCrew") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking || booking.orgId !== org._id) throw new Error("Crew member not found");
    // Hard delete: the booking is the record, and `people` keeps the contact.
    await ctx.db.delete(args.id);
    // Their entry comes off their calendar with it.
    await syncCalendar(ctx, booking.projectId);
    return null;
  },
});

/**
 * Writes the order crew are read out in.
 *
 * Takes the booking ids in their new order and numbers them from zero, so the
 * caller does not have to work out positions and a dragged row cannot collide
 * with an existing one. Bookings not named here keep whatever they had, which
 * puts a booking added mid-drag at the bottom rather than silently first.
 */
export const reorder = mutation({
  args: { projectId: v.id("projects"), orderedIds: v.array(v.id("projectCrew")) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");

    for (const [index, id] of args.orderedIds.entries()) {
      const booking = await ctx.db.get(id);
      // Silently skipping a foreign row rather than throwing: a stale list from
      // another tab should not fail the whole reorder.
      if (!booking || booking.orgId !== org._id || booking.projectId !== args.projectId) continue;
      await ctx.db.patch(id, { sortOrder: index });
    }
    return null;
  },
});
