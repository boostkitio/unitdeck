/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { contactsOf } from "./clients";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

describe("resolving a client's contacts", () => {
  test("a row from before there were contact lists reads as one contact", () => {
    expect(
      contactsOf({ contactName: "Sam Reed", phone: "07700 900000", email: "sam@acme.test" }),
    ).toEqual([
      { name: "Sam Reed", role: undefined, phone: "07700 900000", email: "sam@acme.test" },
    ]);
  });

  test("the single fields and the extras beyond them are one list", () => {
    expect(
      contactsOf({
        contactName: "Sam Reed",
        contacts: [{ name: "Jo Patel", role: "Accounts" }],
      }),
    ).toHaveLength(2);
  });

  test("a first contact mirrored into the single fields is not counted twice", () => {
    const contacts = contactsOf({
      contactName: "Sam Reed",
      phone: "07700 900000",
      contacts: [
        { name: "Sam Reed", role: "Producer", phone: "07700 900000" },
        { name: "Jo Patel", role: "Accounts" },
      ],
    });
    expect(contacts.map((c) => c.name)).toEqual(["Sam Reed", "Jo Patel"]);
    // The stored entry wins, so the role it carries survives.
    expect(contacts[0].role).toBe("Producer");
  });

  test("a client with nobody on it has no contacts", () => {
    expect(contactsOf({})).toEqual([]);
  });
});

test("the main contact can be given a role without appearing twice", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.clients.create, {
    name: "Acme Films",
    contactName: "Sam Reed",
    phone: "07700 900000",
  });

  await asA.mutation(api.clients.saveContact, {
    id,
    index: 0,
    name: "Sam Reed",
    role: "Producer",
    phone: "07700 900000",
    email: "sam@acme.test",
  });

  const client = await asA.query(api.clients.get, { id });
  expect(client?.contacts).toMatchObject([
    { name: "Sam Reed", role: "Producer", phone: "07700 900000", email: "sam@acme.test" },
  ]);
  // Given a stable id the first time they were written, which is how a
  // production names them without counting down the list.
  expect(client?.contacts[0].id).toMatch(/^[a-f0-9]{16}$/);
  // Still mirrored into the single fields, so a CSV export finds somebody.
  expect(client?.contactName).toBe("Sam Reed");
  expect(client?.email).toBe("sam@acme.test");
});

test("adding and removing contacts keeps the list in order", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.clients.create, { name: "Acme Films" });

  await asA.mutation(api.clients.saveContact, { id, name: "Sam Reed", role: "Producer" });
  await asA.mutation(api.clients.saveContact, { id, name: "Jo Patel", role: "Accounts" });
  await asA.mutation(api.clients.saveContact, { id, name: "Ali Khan", role: "Marketing" });

  await asA.mutation(api.clients.removeContact, { id, index: 1 });

  const client = await asA.query(api.clients.get, { id });
  expect(client?.contacts.map((c) => c.name)).toEqual(["Sam Reed", "Ali Khan"]);
  expect(client?.contactName).toBe("Sam Reed");
});

test("removing the last contact leaves the company with nobody", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.clients.create, { name: "Acme Films", contactName: "Sam Reed" });

  await asA.mutation(api.clients.removeContact, { id, index: 0 });

  const client = await asA.query(api.clients.get, { id });
  expect(client?.contacts).toEqual([]);
  expect(client?.contactName).toBeUndefined();
});

test("a re-import replaces the main contact and leaves the rest alone", async () => {
  const { asA } = await setup();
  const id = await asA.mutation(api.clients.create, { name: "Acme Films", contactName: "Sam Reed" });
  await asA.mutation(api.clients.saveContact, { id, name: "Jo Patel", role: "Accounts" });

  await asA.mutation(api.clients.importRows, {
    rows: [{ name: "Acme Films", contactName: "Sam Reed", role: "Producer", email: "sam@acme.test" }],
  });

  const client = await asA.query(api.clients.get, { id });
  expect(client?.contacts).toMatchObject([
    { name: "Sam Reed", role: "Producer", email: "sam@acme.test" },
    { name: "Jo Patel", role: "Accounts" },
  ]);
});

test("another org cannot edit your contacts", async () => {
  const { t, asA } = await setup();
  const id = await asA.mutation(api.clients.create, { name: "Acme Films", contactName: "Sam Reed" });
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  await expect(
    asB.mutation(api.clients.saveContact, { id, index: 0, name: "Intruder" }),
  ).rejects.toThrow(/not found/i);
});

test("who booked the job is one named contact at the client", async () => {
  const { asA } = await setup();
  const clientId = await asA.mutation(api.clients.create, { name: "Acme Films" });
  await asA.mutation(api.clients.saveContact, {
    id: clientId,
    name: "Sam Reed",
    role: "Producer",
    phone: "07700 900000",
  });
  await asA.mutation(api.clients.saveContact, {
    id: clientId,
    name: "Jo Patel",
    role: "Marketing",
    email: "jo@acme.test",
  });
  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId });

  // Nobody chosen yet: the first contact is who it was before there was a
  // choice, so that is who is shown.
  let project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.clientContact?.contactName).toBe("Sam Reed");

  await asA.mutation(api.projects.update, { id: projectId, bookedByContact: 1 });
  project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.clientContact).toMatchObject({
    contactName: "Jo Patel",
    role: "Marketing",
    email: "jo@acme.test",
  });

  // That contact leaving must not point the project at a stranger.
  await asA.mutation(api.clients.removeContact, { id: clientId, index: 1 });
  project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.clientContact?.contactName).toBe("Sam Reed");
});

test("changing the client clears who booked it", async () => {
  const { asA } = await setup();
  const acme = await asA.mutation(api.clients.create, { name: "Acme Films", contactName: "Sam" });
  await asA.mutation(api.clients.saveContact, { id: acme, name: "Jo Patel" });
  const other = await asA.mutation(api.clients.create, { name: "Bravo Ltd", contactName: "Ali" });

  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId: acme });
  await asA.mutation(api.projects.update, { id: projectId, bookedByContact: 1 });
  await asA.mutation(api.projects.update, { id: projectId, clientId: other });

  const project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.bookedByContact).toBe(0);
  expect(project?.clientContact?.contactName).toBe("Ali");
});

test("a production carries only the client contacts that are on it", async () => {
  const { asA } = await setup();
  const clientId = await asA.mutation(api.clients.create, { name: "Acme Films" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Sam Reed", role: "Producer" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Jo Patel", role: "Marketing" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Ali Khan", role: "Accounts" });

  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId });

  const onShoot = () => asA.query(api.projectClients.listForProject, { projectId });

  // Nobody has chosen yet, so everybody is on it — what it did before there
  // was a choice.
  expect((await onShoot()).map((c) => c.name)).toEqual(["Sam Reed", "Jo Patel", "Ali Khan"]);

  // Taking accounts off the shoot leaves the rest on it.
  await asA.mutation(api.projectClients.remove, { projectId, index: 2 });
  expect((await onShoot()).map((c) => c.name)).toEqual(["Sam Reed", "Jo Patel"]);

  // And leaves them in the client's book, which is the whole point.
  const client = await asA.query(api.clients.get, { id: clientId });
  expect(client?.contacts.map((c) => c.name)).toEqual(["Sam Reed", "Jo Patel", "Ali Khan"]);

  // Putting them back on works too.
  await asA.mutation(api.projectClients.add, { projectId, index: 2 });
  expect((await onShoot()).map((c) => c.name)).toEqual(["Sam Reed", "Jo Patel", "Ali Khan"]);
});

test("taking somebody off a shoot cannot reach the client's book", async () => {
  const { asA } = await setup();
  const clientId = await asA.mutation(api.clients.create, { name: "Acme Films" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Sam Reed" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Jo Patel" });

  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId });

  // Every one of them, off the job.
  await asA.mutation(api.projectClients.remove, { projectId, index: 0 });
  await asA.mutation(api.projectClients.remove, { projectId, index: 1 });

  expect(await asA.query(api.projectClients.listForProject, { projectId })).toEqual([]);
  // The record is untouched. This is the bug this table exists to make
  // impossible: an empty shoot list is not an empty address book.
  const client = await asA.query(api.clients.get, { id: clientId });
  expect(client?.contacts.map((c) => c.name)).toEqual(["Sam Reed", "Jo Patel"]);
});

test("deleting a contact from the book leaves the others booked on the job", async () => {
  const { asA } = await setup();
  const clientId = await asA.mutation(api.clients.create, { name: "Acme Films" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Sam Reed" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Jo Patel" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Ali Khan" });

  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId });
  await asA.mutation(api.projectClients.remove, { projectId, index: 0 });

  // Jo and Ali are on the shoot. Removing Jo from the book moves Ali up a
  // place — and because the booking names her by id, Ali stays Ali.
  await asA.mutation(api.clients.removeContact, { id: clientId, index: 1 });

  const onShoot = await asA.query(api.projectClients.listForProject, { projectId });
  expect(onShoot.map((c) => c.name)).toEqual(["Ali Khan"]);
});

test("who booked the job survives somebody above them being deleted", async () => {
  const { asA } = await setup();
  const clientId = await asA.mutation(api.clients.create, { name: "Acme Films" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Sam Reed" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Jo Patel" });
  await asA.mutation(api.clients.saveContact, { id: clientId, name: "Ali Khan" });

  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId });
  await asA.mutation(api.projects.update, { id: projectId, bookedByContact: 2 });

  await asA.mutation(api.clients.removeContact, { id: clientId, index: 0 });

  const project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.clientContact?.contactName).toBe("Ali Khan");
});

test("changing the client takes the old client's people off the job", async () => {
  const { asA } = await setup();
  const acme = await asA.mutation(api.clients.create, { name: "Acme Films" });
  await asA.mutation(api.clients.saveContact, { id: acme, name: "Sam Reed" });
  const other = await asA.mutation(api.clients.create, { name: "Bravo Ltd" });
  await asA.mutation(api.clients.saveContact, { id: other, name: "Ali Khan" });

  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId: acme });
  await asA.mutation(api.projectClients.add, { projectId, index: 0 });
  await asA.mutation(api.projects.update, { id: projectId, clientId: other });

  const onShoot = await asA.query(api.projectClients.listForProject, { projectId });
  expect(onShoot.map((c) => c.name)).toEqual(["Ali Khan"]);
});

test("another org cannot change who is on your production", async () => {
  const { t, asA } = await setup();
  const clientId = await asA.mutation(api.clients.create, { name: "Acme Films", contactName: "Sam" });
  const projectId = await asA.mutation(api.projects.create, { name: "Brand film" });
  await asA.mutation(api.projects.update, { id: projectId, clientId });
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });

  await expect(
    asB.mutation(api.projectClients.remove, { projectId, index: 0 }),
  ).rejects.toThrow(/not found/i);
  expect(await asB.query(api.projectClients.listForProject, { projectId })).toEqual([]);
});
