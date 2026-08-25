import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";

export type ClientContact = {
  id?: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
};

/** Short, unguessable, and stable once written. */
function newContactId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const contactValidator = v.object({
  id: v.optional(v.string()),
  name: v.string(),
  role: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
});

/**
 * Every contact at a client, with the original single contact first.
 *
 * A client used to hold one name, phone and email. Those fields are still
 * where an existing row keeps its person, so reads present them as the first
 * contact rather than losing them or making anyone retype.
 *
 * Writes now mirror the first contact back into those fields, which is what
 * keeps a CSV export and any older read working. That mirror is recognised
 * here so the main contact appears once, not twice.
 */
export function contactsOf(client: {
  contactName?: string;
  phone?: string;
  email?: string;
  contacts?: ClientContact[];
}): ClientContact[] {
  const legacy: ClientContact[] =
    client.contactName?.trim() || client.phone?.trim() || client.email?.trim()
      ? [
          {
            id: undefined,
            name: client.contactName?.trim() || "Main contact",
            role: undefined,
            phone: client.phone,
            email: client.email,
          },
        ]
      : [];
  const rest = client.contacts ?? [];
  if (legacy.length > 0 && rest.length > 0 && isMirrorOf(legacy[0], rest[0])) return rest;
  return [...legacy, ...rest];
}

/** Whether the legacy fields are just a copy of the first stored contact. */
function isMirrorOf(legacy: ClientContact, first: ClientContact): boolean {
  const same = (a?: string, b?: string) => (a ?? "").trim() === (b ?? "").trim();
  return (
    legacy.name.trim().toLowerCase() === first.name.trim().toLowerCase() &&
    same(legacy.phone, first.phone) &&
    same(legacy.email, first.email)
  );
}

function tidy(contacts: ClientContact[]): ClientContact[] {
  return contacts
    .map((c) => ({
      // Given one the first time they are written, and never changed after.
      id: c.id ?? newContactId(),
      name: c.name.trim(),
      role: c.role?.trim() || undefined,
      phone: c.phone?.trim() || undefined,
      email: c.email?.trim() || undefined,
    }))
    // A contact with no name is a blank row somebody left behind.
    .filter((c) => c.name.length > 0);
}

/**
 * Store the whole contact list, keeping the legacy single-contact fields as a
 * mirror of the first entry so exports, imports and any older read still find
 * somebody there.
 */
async function writeContacts(ctx: MutationCtx, id: Id<"clients">, contacts: ClientContact[]) {
  const cleaned = tidy(contacts);
  const first = cleaned[0];
  await ctx.db.patch(id, {
    contacts: cleaned.length > 0 ? cleaned : undefined,
    contactName: first?.name,
    phone: first?.phone,
    email: first?.email,
  });
  return cleaned;
}

async function ownedClient(ctx: MutationCtx, id: Id<"clients">): Promise<Doc<"clients">> {
  const { org } = await requireOrg(ctx);
  const client = await ctx.db.get(id);
  if (!client || client.orgId !== org._id) throw new Error("Client not found");
  return client;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    // Contacts resolved here rather than in every caller: the tab, the
    // project card and the "booked by" picker all want the same list.
    return clients
      .filter((c) => !c.archived)
      .map((c) => ({ ...c, contacts: contactsOf(c) }));
  },
});

/** One client with its contacts resolved, for the project's client card. */
export const get = query({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const client = await ctx.db.get(args.id);
    if (!client || client.orgId !== org._id) return null;
    return { ...client, contacts: contactsOf(client) };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    contacts: v.optional(v.array(contactValidator)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    if (args.name.trim().length === 0) throw new Error("Company is required");
    const id = await ctx.db.insert("clients", {
      orgId: org._id,
      name: args.name.trim(),
      notes: args.notes,
    });
    const contacts =
      args.contacts && args.contacts.length > 0
        ? args.contacts
        : contactsOf({
            contactName: args.contactName,
            phone: args.phone,
            email: args.email,
          });
    await writeContacts(ctx, id, contacts);
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("clients"),
    name: v.optional(v.string()),
    contactName: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    /** The whole list, first entry first — not the extras beyond a main one. */
    contacts: v.optional(v.array(contactValidator)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ownedClient(ctx, args.id);
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) throw new Error("Company is required");
      patch.name = args.name.trim();
    }
    if (args.notes !== undefined) patch.notes = args.notes;
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.id, patch);

    if (args.contacts !== undefined) {
      await writeContacts(ctx, args.id, args.contacts);
    } else if (
      args.contactName !== undefined ||
      args.phone !== undefined ||
      args.email !== undefined
    ) {
      // An older client only knows about the single contact; fold it into the
      // first row rather than letting the two disagree.
      const client = await ownedClient(ctx, args.id);
      const contacts = contactsOf(client);
      const first: ClientContact = {
        ...(contacts[0] ?? { name: "" }),
        name: args.contactName === undefined ? (contacts[0]?.name ?? "") : (args.contactName ?? ""),
        phone: args.phone === undefined ? contacts[0]?.phone : (args.phone ?? undefined),
        email: args.email === undefined ? contacts[0]?.email : (args.email ?? undefined),
      };
      await writeContacts(ctx, args.id, [first, ...contacts.slice(1)]);
    }
    return null;
  },
});

/**
 * Add or edit one contact, addressed by its place in the resolved list.
 *
 * Editing a contact from the project's client card goes through here, so the
 * role can be set on the main contact too — which the single-contact fields
 * never had room for.
 */
export const saveContact = mutation({
  args: {
    id: v.id("clients"),
    /** Omitted to add a new contact at the end. */
    index: v.optional(v.number()),
    name: v.string(),
    role: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const client = await ownedClient(ctx, args.id);
    if (args.name.trim().length === 0) throw new Error("A contact needs a name");
    const contacts = contactsOf(client);
    const next: ClientContact = {
      name: args.name,
      role: args.role,
      phone: args.phone,
      email: args.email,
    };
    let at: number;
    if (args.index === undefined || args.index < 0 || args.index >= contacts.length) {
      at = contacts.length;
      contacts.push(next);
    } else {
      at = args.index;
      contacts[args.index] = next;
    }
    const written = await writeContacts(ctx, args.id, contacts);
    // Where they ended up, so a caller adding somebody can put them straight
    // onto the production they were adding them for.
    return Math.min(at, Math.max(written.length - 1, 0));
  },
});

/**
 * Give every contact at a client an id, if they have not got one.
 *
 * Idempotent, and the only way a production can name one of these without
 * counting down the list — which is what made removing one from a shoot
 * dangerous in the first place.
 */
export async function ensureContactIds(
  ctx: MutationCtx,
  clientId: Id<"clients">
): Promise<Required<Pick<ClientContact, "id">>[] & ClientContact[]> {
  const client = await ctx.db.get(clientId);
  if (!client) throw new Error("Client not found");
  const contacts = contactsOf(client);
  if (contacts.length > 0 && contacts.every((c) => c.id)) {
    return contacts as (ClientContact & { id: string })[];
  }
  const written = await writeContacts(ctx, clientId, contacts);
  return written as (ClientContact & { id: string })[];
}

export const removeContact = mutation({
  args: { id: v.id("clients"), index: v.number() },
  handler: async (ctx, args) => {
    const client = await ownedClient(ctx, args.id);
    const contacts = contactsOf(client);
    if (args.index < 0 || args.index >= contacts.length) throw new Error("Contact not found");
    contacts.splice(args.index, 1);
    await writeContacts(ctx, args.id, contacts);
    await closeGapInProjects(ctx, args.id, args.index);
    return null;
  },
});

/**
 * Everyone after a removed contact moves up one, so every project that
 * pointed past them is now pointing at the wrong person.
 *
 * Positions are how a production names a client's contacts, which is what
 * makes this necessary: the alternative is a project quietly listing
 * whoever happened to move into the gap.
 */
async function closeGapInProjects(ctx: MutationCtx, clientId: Id<"clients">, removed: number) {
  const client = await ownedClient(ctx, clientId);
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", client.orgId))
    .take(1000);
  for (const project of projects) {
    if (project.clientId !== clientId) continue;
    const patch: Record<string, unknown> = {};

    if (project.clientContacts !== undefined) {
      patch.clientContacts = project.clientContacts
        .filter((i) => i !== removed)
        .map((i) => (i > removed ? i - 1 : i));
    }
    if (project.bookedByContact !== undefined) {
      patch.bookedByContact =
        project.bookedByContact === removed
          ? undefined
          : project.bookedByContact > removed
            ? project.bookedByContact - 1
            : project.bookedByContact;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(project._id, patch);
  }
}

// One transaction's worth. The client sends larger files in successive batches.
const MAX_IMPORT_ROWS = 200;

/**
 * Bulk insert from a parsed CSV. Rows without a company are skipped rather
 * than failing the batch, so one bad line cannot cost the whole import; the
 * caller is told how many were skipped.
 *
 * Matching an existing client by company name updates it instead of inserting
 * a duplicate, which makes re-importing a corrected file safe.
 */
export const importRows = mutation({
  args: {
    rows: v.array(
      v.object({
        name: v.string(),
        contactName: v.optional(v.string()),
        role: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        notes: v.optional(v.string()),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ created: number; updated: number; skipped: number; notes: string[] }> => {
    const { org } = await requireOrg(ctx);
    if (args.rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    }

    const existing = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(1000);
    const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));

    let created = 0;
    let updated = 0;
    let unnamed = 0;

    for (const row of args.rows) {
      const name = row.name.trim();
      if (name.length === 0) {
        unnamed++;
        continue;
      }
      const contact: ClientContact = {
        name: row.contactName?.trim() || "",
        role: row.role?.trim() || undefined,
        phone: row.phone?.trim() || undefined,
        email: row.email?.trim() || undefined,
      };
      const hasContact =
        contact.name.length > 0 || contact.phone !== undefined || contact.email !== undefined;
      if (hasContact && contact.name.length === 0) contact.name = "Main contact";

      const match = byName.get(name.toLowerCase());
      if (match) {
        if (row.notes?.trim()) await ctx.db.patch(match._id, { notes: row.notes.trim() });
        if (hasContact) {
          // Replaces the main contact rather than the whole book: everybody
          // else at the company was added here, not in the spreadsheet.
          const contacts = contactsOf(match);
          await writeContacts(ctx, match._id, [contact, ...contacts.slice(1)]);
        }
        updated++;
      } else {
        const id = await ctx.db.insert("clients", {
          orgId: org._id,
          name,
          notes: row.notes?.trim() || undefined,
        });
        if (hasContact) await writeContacts(ctx, id, [contact]);
        // Keep the map current so duplicate rows in one file collapse too.
        byName.set(name.toLowerCase(), (await ctx.db.get(id))!);
        created++;
      }
    }

    const notes: string[] = [];
    if (unnamed > 0) {
      notes.push(`${unnamed} row${unnamed === 1 ? "" : "s"} had no name and were not imported.`);
    }
    if (updated > 0) {
      notes.push(`${updated} matched a client already on the list by name and were updated rather than added.`);
    }

    return { created, updated, skipped: unnamed, notes };
  },
});

export const remove = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    await ownedClient(ctx, args.id);
    await ctx.db.patch(args.id, { archived: true });
    return null;
  },
});
