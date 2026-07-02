/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Set-mode links expire 7 days after the shoot date, so fixtures must use a
// relative date; a hardcoded literal rots into "This link has expired".
const NEAR_FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA,
      name: "P",
      status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA,
      projectId: projectA,
      date: NEAR_FUTURE,
      locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [
      { name: "Sam", role: "Sound", email: "sam@example.test", callTime: "07:30" },
      { name: "Alex", role: "DP", email: "alex@example.test", callTime: "07:00" },
    ],
  });
  const runId = await t.run(async (ctx) =>
    ctx.db.insert("agentRuns", {
      orgId: ids.orgA,
      shootDayId: ids.dayA,
      agent: "message_drafter",
      model: "test-model",
      input: "chase context",
      proposal: {
        kind: "message",
        subject: "Please confirm",
        body: "Can you confirm for Thursday?",
      },
      status: "proposed",
    })
  );
  return { t, ids, asA, runId };
}

test("approveAndSend stamps the run and queues sends for unconfirmed recipients", async () => {
  const { t, ids, asA, runId } = await setup();
  // One of two confirms; the chase should target only the other
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  const sam = recipients.find((r) => r.name === "Sam")!;
  await t.mutation(api.setMode.confirm, { token: sam.token });

  const queued = await asA.mutation(api.agents.messageDrafter.approveAndSend, {
    runId,
    subject: "Please confirm (edited)",
    body: "Quick nudge: can you confirm?",
  });
  expect(queued).toBe(1); // only Alex
  const run = await t.run(async (ctx) => ctx.db.get(runId));
  expect(run?.status).toBe("approved");
  expect(run?.decidedBy).toBe("user_a");
});

test("approveAndSend refuses when no one is unconfirmed", async () => {
  const { t, asA, ids, runId } = await setup();
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  for (const r of recipients) await t.mutation(api.setMode.confirm, { token: r.token });
  await expect(
    asA.mutation(api.agents.messageDrafter.approveAndSend, {
      runId,
      subject: "s",
      body: "b",
    })
  ).rejects.toThrow("Everyone has already confirmed");
});

test("reject stamps the run", async () => {
  const { t, asA, runId } = await setup();
  await asA.mutation(api.agents.messageDrafter.reject, { runId });
  const run = await t.run(async (ctx) => ctx.db.get(runId));
  expect(run?.status).toBe("rejected");
});
