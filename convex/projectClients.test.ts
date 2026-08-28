/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("a client is on site or off, and it is remembered per production", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const org = await ctx.db.insert("organisations", { name: "Klaxon", clerkOrgId: "org_att" });
    const client = await ctx.db.insert("clients", {
      orgId: org,
      name: "Acme",
      contacts: [
        { id: "c1", name: "Ada Vaughn", role: "Marketing" },
        { id: "c2", name: "Ben Okoro", role: "Brand" },
      ],
    });
    const project = await ctx.db.insert("projects", {
      orgId: org,
      name: "Brand film",
      status: "confirmed",
      clientId: client,
    });
    return { project };
  });
  const asA = t.withIdentity({ subject: "user_att", org_id: "org_att" });

  // Off site until somebody says otherwise: most clients never come.
  let contacts = await asA.query(api.projectClients.listForProject, {
    projectId: ids.project,
  });
  expect(contacts.map((c) => c.attendance)).toEqual(["off_site", "off_site"]);

  await asA.mutation(api.projectClients.setAttendance, {
    projectId: ids.project,
    index: 0,
    attendance: "on_site",
  });

  contacts = await asA.query(api.projectClients.listForProject, { projectId: ids.project });
  expect(contacts[0].attendance).toBe("on_site");
  // And it is about this job, not about them: the other one is untouched.
  expect(contacts[1].attendance).toBe("off_site");

  // Changed back again, because a client who was coming often stops.
  await asA.mutation(api.projectClients.setAttendance, {
    projectId: ids.project,
    index: 0,
    attendance: "off_site",
  });
  contacts = await asA.query(api.projectClients.listForProject, { projectId: ids.project });
  expect(contacts[0].attendance).toBe("off_site");
});
