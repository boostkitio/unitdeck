import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";

export type ProjectCrewMember = {
  _id: Id<"projectCrew">;
  personId: Id<"people">;
  name: string;
  // The project role when one was set, otherwise the person's default role.
  role: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

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

    const bookings = await ctx.db
      .query("projectCrew")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);

    const members: ProjectCrewMember[] = [];
    for (const booking of bookings) {
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
      });
    }
    members.sort((a, b) => a.name.localeCompare(b.name));
    return members;
  },
});

export const add = mutation({
  args: {
    projectId: v.id("projects"),
    personId: v.id("people"),
    role: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
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

    return await ctx.db.insert("projectCrew", {
      orgId: org._id,
      projectId: args.projectId,
      personId: args.personId,
      role: args.role?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projectCrew"),
    role: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const booking = await ctx.db.get(args.id);
    if (!booking || booking.orgId !== org._id) throw new Error("Crew member not found");

    const patch: Partial<Doc<"projectCrew">> = {};
    // null clears the override and falls back to the person's default role.
    if (args.role !== undefined) patch.role = args.role?.trim() || undefined;
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;

    await ctx.db.patch(args.id, patch);
    return null;
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
    return null;
  },
});
