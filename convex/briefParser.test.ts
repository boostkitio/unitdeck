/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const runId = await ctx.db.insert("agentRuns", {
      orgId: orgA,
      agent: "brief_parser",
      model: "test-model",
      input: "We need a two-day brand film for Acme in late June…",
      proposal: {
        kind: "brief",
        projectName: "Acme brand film",
        clientName: "Acme",
        briefSummary: "Two-day brand film.",
        shootDays: [{ date: "2026-06-29", label: "Day 1" }],
      },
      status: "proposed",
    });
    return { orgA, runId };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("approve creates client, project and shoot days, and stamps the run", async () => {
  const { t, ids, asA } = await setup();
  const projectId = await asA.mutation(api.agents.briefParser.approve, {
    runId: ids.runId,
    projectName: "Acme brand film (edited)",
    clientName: "Acme",
    briefSummary: "Two-day brand film.",
    shootDays: [{ date: "2026-06-29", label: "Day 1" }, { date: "2026-06-30" }],
  });
  const project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.name).toBe("Acme brand film (edited)"); // edited value wins
  expect(project?.clientName).toBe("Acme");
  const days = await asA.query(api.shootDays.listForProject, { projectId });
  expect(days).toHaveLength(2);
  const run = await t.run(async (ctx) => ctx.db.get(ids.runId));
  expect(run?.status).toBe("approved");
  expect(run?.decidedBy).toBe("user_a");
  expect(run?.projectId).toBe(projectId);
});

test("approve reuses an existing client case-insensitively", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("clients", { orgId: ids.orgA, name: "ACME" });
  });
  const projectId = await asA.mutation(api.agents.briefParser.approve, {
    runId: ids.runId,
    projectName: "P",
    clientName: "acme",
    shootDays: [],
  });
  const clients = await asA.query(api.clients.list, {});
  expect(clients).toHaveLength(1); // no duplicate created
  const project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.clientName).toBe("ACME");
});

test("reject stamps the run and creates nothing", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.agents.briefParser.reject, { runId: ids.runId });
  const run = await t.run(async (ctx) => ctx.db.get(ids.runId));
  expect(run?.status).toBe("rejected");
  expect(await asA.query(api.projects.list, {})).toHaveLength(0);
});

test("a decided run cannot be approved again, and cross-org is rejected", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  await expect(
    asB.mutation(api.agents.briefParser.reject, { runId: ids.runId })
  ).rejects.toThrow("Run not found");
  await asA.mutation(api.agents.briefParser.reject, { runId: ids.runId });
  await expect(
    asA.mutation(api.agents.briefParser.approve, {
      runId: ids.runId,
      projectName: "P",
      shootDays: [],
    })
  ).rejects.toThrow("already been decided");
});
