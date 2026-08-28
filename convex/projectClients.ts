import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { type ClientContact, contactsOf, ensureContactIds } from "./clients";

export type ProjectClientContact = ClientContact & {
  /** The booking, not the contact: this is what a removal deletes. */
  bookingId: Id<"projectClients"> | null;
  /** Where they sit in the client's book, for addressing them from the UI. */
  index: number;
  /** Notes about them on this production only. */
  notes: string | null;
  /** Whether they are coming to the shoot. Absent reads as off site. */
  attendance: "on_site" | "off_site";
};

async function ownedProject(ctx: QueryCtx | MutationCtx, id: Id<"projects">) {
  const { org } = await requireOrg(ctx);
  const project = await ctx.db.get(id);
  if (!project || project.orgId !== org._id) throw new Error("Project not found");
  return { org, project };
}

/**
 * Records who is on the production today, once somebody first prunes the list.
 *
 * Until that happens the list is "everybody at the client", held as the
 * absence of rows. The first change has to write that out in full or it would
 * read as "only the one you just touched". A contact who already has a row —
 * because a note was written against them — keeps it rather than gaining a
 * second.
 */
async function writeOutBook(
  ctx: MutationCtx,
  orgId: Id<"organisations">,
  projectId: Id<"projects">,
  clientId: Id<"clients">,
  book: ClientContact[],
  existing: Doc<"projectClients">[],
  except?: string,
) {
  const already = new Set(existing.map((row) => row.contactId));
  for (const person of book) {
    if (!person.id || person.id === except || already.has(person.id)) continue;
    await ctx.db.insert("projectClients", { orgId, projectId, clientId, contactId: person.id });
  }
  if (except !== undefined) {
    for (const row of existing) {
      if (row.contactId === except) await ctx.db.delete(row._id);
    }
  }
  await ctx.db.patch(projectId, { clientContactsChosen: true });
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
    // A note can exist before anybody has pruned the list, so it is looked up
    // by contact in both branches rather than only where bookings are read.
    const noted = new Map(mine.map((r) => [r.contactId, r.notes ?? null]));
    const attending = new Map(
      mine.map((r) => [r.contactId, r.attendance ?? ("off_site" as const)])
    );

    if (!project.clientContactsChosen) {
      return book.map((contact, index) => ({
        ...contact,
        bookingId: null,
        index,
        notes: contact.id ? (noted.get(contact.id) ?? null) : null,
        attendance: contact.id ? (attending.get(contact.id) ?? "off_site") : "off_site",
      }));
    }

    const booked = new Map(mine.map((r) => [r.contactId, r._id]));
    return book
      .map((contact, index) => ({ ...contact, index }))
      .filter((contact) => contact.id !== undefined && booked.has(contact.id))
      .map((contact) => ({
        ...contact,
        bookingId: booked.get(contact.id!)!,
        notes: noted.get(contact.id!) ?? null,
        attendance: attending.get(contact.id!) ?? ("off_site" as const),
      }));
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
      await writeOutBook(ctx, org._id, args.projectId, project.clientId, book, mine);
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
      await writeOutBook(ctx, org._id, args.projectId, project.clientId, book, mine, contact.id);
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

/**
 * A note about somebody on this production.
 *
 * Written against the booking, never against the client's book: what they are
 * doing on this job is not a fact about them at the company. Writing one
 * before anybody has pruned the list settles who is on it first — the same
 * thing adding or removing does, and it takes nobody off.
 */
/**
 * Whether a client is on set or working from their own desk.
 *
 * Written against the booking like a note is, and for the same reason: it is
 * true of this production and not of the client. Setting it before anybody has
 * pruned the list settles who is on the job first, and takes nobody off.
 */
export const setAttendance = mutation({
  args: {
    projectId: v.id("projects"),
    index: v.number(),
    attendance: v.union(v.literal("on_site"), v.literal("off_site")),
  },
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
      await writeOutBook(ctx, org._id, args.projectId, project.clientId, book, mine);
    }

    const fresh = await ctx.db
      .query("projectClients")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const row = fresh.find(
      (r) => r.clientId === project.clientId && r.contactId === contact.id,
    );
    if (!row) throw new Error("They are not on this production");
    await ctx.db.patch(row._id, { attendance: args.attendance });
    return null;
  },
});

export const setNotes = mutation({
  args: { projectId: v.id("projects"), index: v.number(), notes: v.string() },
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
      await writeOutBook(ctx, org._id, args.projectId, project.clientId, book, mine);
    }

    const fresh = await ctx.db
      .query("projectClients")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const row = fresh.find(
      (r) => r.clientId === project.clientId && r.contactId === contact.id,
    );
    if (!row) throw new Error("They are not on this production");
    await ctx.db.patch(row._id, { notes: args.notes.trim() || undefined });
    return null;
  },
});
