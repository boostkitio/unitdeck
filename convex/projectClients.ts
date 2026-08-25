import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { type ClientContact, contactsOf, ensureContactIds } from "./clients";

export type ProjectClientContact = ClientContact & {
  /** The booking, not the contact: this is what a removal deletes. */
  bookingId: Id<"projectClients"> | null;
  /** Where they sit in the client's book, for addressing them from the UI. */
  index: number;
};

async function ownedProject(ctx: QueryCtx | MutationCtx, id: Id<"projects">) {
  const { org } = await requireOrg(ctx);
  const project = await ctx.db.get(id);
  if (!project || project.orgId !== org._id) throw new Error("Project not found");
  return { org, project };
}

/**
 * The client's people who are on this production.
 *
 * A booking row per person, exactly as crew are booked: the client's book is
 * the company record and these are this job's selection from it. No booking
 * rows at all means nobody has chosen yet, which reads as everybody — what it
 * did before there was a choice, so no production changes underneath anyone.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<ProjectClientContact[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];
    const client = project.clientId ? await ctx.db.get(project.clientId) : null;
    if (!client || client.orgId !== org._id) return [];

    const book = contactsOf(client);
    const rows = await ctx.db
      .query("projectClients")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const mine = rows.filter((r) => r.orgId === org._id && r.clientId === client._id);

    // Nobody has chosen yet, so all of them are on it. Once somebody has,
    // an empty list means nobody — which is a different thing, and why the
    // count alone cannot be the test.
    if (!project.clientContactsChosen) {
      return book.map((contact, index) => ({ ...contact, bookingId: null, index }));
    }

    const booked = new Map(mine.map((r) => [r.contactId, r._id]));
    return book
      .map((contact, index) => ({ ...contact, index }))
      .filter((contact) => contact.id !== undefined && booked.has(contact.id))
      .map((contact) => ({ ...contact, bookingId: booked.get(contact.id!)! }));
  },
});

/**
 * Put one of the client's people on this production.
 *
 * Addressed by their place in the book, which is all the page can see — but
 * resolved to a stable id inside this transaction, so nothing is stored that
 * shifts when the book changes.
 */
export const add = mutation({
  args: { projectId: v.id("projects"), index: v.number() },
  handler: async (ctx, args) => {
    const { org, project } = await ownedProject(ctx, args.projectId);
    if (!project.clientId) throw new Error("This production has no client");
    const book = await ensureContactIds(ctx, project.clientId);
    const contact = book[args.index];
    if (!contact?.id) throw new Error("Contact not found");

    const rows = await ctx.db
      .query("projectClients")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const mine = rows.filter((r) => r.clientId === project.clientId);

    // First change writes out who is on it today, so adding one does not
    // silently take everybody else off.
    if (!project.clientContactsChosen) {
      for (const person of book) {
        if (!person.id) continue;
        await ctx.db.insert("projectClients", {
          orgId: org._id,
          projectId: args.projectId,
          clientId: project.clientId,
          contactId: person.id,
        });
      }
      await ctx.db.patch(args.projectId, { clientContactsChosen: true });
      return null;
    }

    if (mine.some((r) => r.contactId === contact.id)) return null;
    await ctx.db.insert("projectClients", {
      orgId: org._id,
      projectId: args.projectId,
      clientId: project.clientId,
      contactId: contact.id,
    });
    return null;
  },
});

/**
 * Take somebody off this production.
 *
 * Deletes the booking and nothing else. There is deliberately no path from
 * here to the client's book: this exists because conflating the two lost
 * people's details.
 */
export const remove = mutation({
  args: { projectId: v.id("projects"), index: v.number() },
  handler: async (ctx, args) => {
    const { org, project } = await ownedProject(ctx, args.projectId);
    if (!project.clientId) throw new Error("This production has no client");
    const book = await ensureContactIds(ctx, project.clientId);
    const contact = book[args.index];
    if (!contact?.id) throw new Error("Contact not found");

    const rows = await ctx.db
      .query("projectClients")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const mine = rows.filter((r) => r.clientId === project.clientId);

    if (!project.clientContactsChosen) {
      // Nobody had chosen, so everybody was on it. Write that out minus this
      // one rather than leaving the list looking untouched.
      for (const person of book) {
        if (!person.id || person.id === contact.id) continue;
        await ctx.db.insert("projectClients", {
          orgId: org._id,
          projectId: args.projectId,
          clientId: project.clientId,
          contactId: person.id,
        });
      }
      await ctx.db.patch(args.projectId, { clientContactsChosen: true });
      return null;
    }

    for (const row of mine) {
      if (row.contactId === contact.id) await ctx.db.delete(row._id);
    }
    return null;
  },
});

/** Bookings for a client that is no longer on the project, or was replaced. */
export async function clearForProject(ctx: MutationCtx, projectId: Id<"projects">) {
  const rows = await ctx.db
    .query("projectClients")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(500);
  for (const row of rows) await ctx.db.delete(row._id);
  // Back to nobody having chosen, so the new client's people all show.
  await ctx.db.patch(projectId, { clientContactsChosen: undefined });
}
