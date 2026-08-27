/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
  });
  return { t, asA: t.withIdentity({ subject: "user_a", org_id: "org_a", name: "Test User" }) };
}

test("submit stores org-scoped feedback with the page path", async () => {
  const { t, asA } = await setup();
  await asA.mutation(api.feedback.submit, {
    message: "The schedule blocks should support drag and drop.",
    page: "/projects/abc/shoot-days/def/call-sheet",
  });
  const rows = await t.run(async (ctx) => ctx.db.query("feedback").take(10));
  expect(rows).toHaveLength(1);
  expect(rows[0].orgName).toBe("Org A");
  expect(rows[0].userId).toBe("user_a");
  expect(rows[0].page).toContain("call-sheet");
});

test("empty feedback is rejected", async () => {
  const { asA } = await setup();
  await expect(
    asA.mutation(api.feedback.submit, { message: "  ", page: "/dashboard" })
  ).rejects.toThrow("Write a sentence");
});

test("unauthenticated submission is rejected", async () => {
  const { t } = await setup();
  await expect(
    t.mutation(api.feedback.submit, { message: "hello there", page: "/" })
  ).rejects.toThrow("Not authenticated");
});

test("list returns newest-first with correct type/status, and setStatus updates it", async () => {
  const { asA } = await setup();

  // Submit two items on different pages with different types
  await asA.mutation(api.feedback.submit, {
    message: "The dashboard is missing a summary card.",
    page: "/dashboard",
    type: "missing",
  });
  await asA.mutation(api.feedback.submit, {
    message: "The export button throws an error every time.",
    page: "/projects",
    type: "issue",
  });

  // list should return both, newest first
  const items = await asA.query(api.feedback.list, {});
  expect(items).toHaveLength(2);

  // Newest first: the second submission (issue on /projects) should be first
  expect(items[0].page).toBe("/projects");
  expect(items[0].type).toBe("issue");
  expect(items[0].status).toBe("open");

  expect(items[1].page).toBe("/dashboard");
  expect(items[1].type).toBe("missing");
  expect(items[1].status).toBe("open");

  // Mark the first item addressed
  await asA.mutation(api.feedback.setStatus, {
    id: items[0]._id,
    status: "addressed",
  });

  // list should now show the updated status
  const updated = await asA.query(api.feedback.list, {});
  const addressed = updated.find((i) => i._id === items[0]._id);
  const stillOpen = updated.find((i) => i._id === items[1]._id);
  expect(addressed?.status).toBe("addressed");
  expect(stillOpen?.status).toBe("open");
});

// ---------------------------------------------------------------------------
// Replies, and editing your own words
// ---------------------------------------------------------------------------

async function threadSetup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  return {
    t,
    asMatt: t.withIdentity({ subject: "user_matt", org_id: "org_a" }),
    asCharlie: t.withIdentity({ subject: "user_charlie", org_id: "org_a" }),
    asOutsider: t.withIdentity({ subject: "user_outsider", org_id: "org_b" }),
  };
}

async function oneItem(asMatt: Awaited<ReturnType<typeof threadSetup>>["asMatt"]) {
  await asMatt.mutation(api.feedback.submit, {
    message: "The kit list should show serial numbers",
    page: "/projects",
  });
  const items = await asMatt.query(api.feedback.list, {});
  return items[0];
}

test("a colleague can reply, and the thread reads oldest first", async () => {
  const { asMatt, asCharlie } = await threadSetup();
  const item = await oneItem(asMatt);

  await asCharlie.mutation(api.feedback.reply, {
    feedbackId: item._id,
    message: "Agreed, the rental house asks every time",
  });
  await asMatt.mutation(api.feedback.reply, {
    feedbackId: item._id,
    message: "Shipped this morning",
  });

  const [withReplies] = await asMatt.query(api.feedback.list, {});
  expect(withReplies.replies.map((r) => r.message)).toEqual([
    "Agreed, the rental house asks every time",
    "Shipped this morning",
  ]);
  // Whose is whose, since that is what gates the edit button.
  expect(withReplies.replies.map((r) => r.mine)).toEqual([false, true]);
});

test("you can rewrite your own comment, and it is marked as edited", async () => {
  const { asMatt } = await threadSetup();
  const item = await oneItem(asMatt);
  expect(item.edited).toBe(false);

  await asMatt.mutation(api.feedback.edit, {
    id: item._id,
    message: "The kit list should show serial numbers, and the hire company",
  });

  const [edited] = await asMatt.query(api.feedback.list, {});
  expect(edited.message).toBe(
    "The kit list should show serial numbers, and the hire company"
  );
  expect(edited.edited).toBe(true);
});

test("you cannot rewrite somebody else's comment", async () => {
  const { asMatt, asCharlie } = await threadSetup();
  const item = await oneItem(asMatt);

  await expect(
    asCharlie.mutation(api.feedback.edit, { id: item._id, message: "I never said this" })
  ).rejects.toThrow(/not yours/i);

  const [unchanged] = await asMatt.query(api.feedback.list, {});
  expect(unchanged.message).toBe("The kit list should show serial numbers");
  expect(unchanged.edited).toBe(false);
});

test("marking addressed is still anyone's to do — only the words are the author's", async () => {
  const { asMatt, asCharlie } = await threadSetup();
  const item = await oneItem(asMatt);

  await asCharlie.mutation(api.feedback.setStatus, { id: item._id, status: "addressed" });
  const [after] = await asMatt.query(api.feedback.list, {});
  expect(after.status).toBe("addressed");
});

test("you can rewrite your own reply but not a colleague's", async () => {
  const { asMatt, asCharlie } = await threadSetup();
  const item = await oneItem(asMatt);
  const replyId = await asCharlie.mutation(api.feedback.reply, {
    feedbackId: item._id,
    message: "Agred",
  });

  await asCharlie.mutation(api.feedback.editReply, { id: replyId, message: "Agreed" });
  let [thread] = await asMatt.query(api.feedback.list, {});
  expect(thread.replies[0]).toMatchObject({ message: "Agreed", edited: true });

  await expect(
    asMatt.mutation(api.feedback.editReply, { id: replyId, message: "Disagreed" })
  ).rejects.toThrow(/not yours/i);
  [thread] = await asMatt.query(api.feedback.list, {});
  expect(thread.replies[0].message).toBe("Agreed");
});

test("an empty reply is refused", async () => {
  const { asMatt } = await threadSetup();
  const item = await oneItem(asMatt);
  await expect(
    asMatt.mutation(api.feedback.reply, { feedbackId: item._id, message: "   " })
  ).rejects.toThrow(/something to reply/i);
});

test("a thread does not cross to another account", async () => {
  const { asMatt, asOutsider } = await threadSetup();
  const item = await oneItem(asMatt);
  await asMatt.mutation(api.feedback.reply, { feedbackId: item._id, message: "Mine" });

  expect(await asOutsider.query(api.feedback.list, {})).toEqual([]);
  await expect(
    asOutsider.mutation(api.feedback.reply, { feedbackId: item._id, message: "Nosy" })
  ).rejects.toThrow(/not found/i);
  await expect(
    asOutsider.mutation(api.feedback.edit, { id: item._id, message: "Rewritten by a stranger" })
  ).rejects.toThrow(/not found/i);
});

// The name follows the person, not the row: feedback written before somebody
// named themselves should read as them once they have.
test("an author reads as the name they have since set", async () => {
  const { asMatt } = await threadSetup();
  const item = await oneItem(asMatt);
  expect(item.who).toBe("Someone");

  await asMatt.mutation(api.memberProfiles.setName, { firstName: "Matt", lastName: "West" });
  const [named] = await asMatt.query(api.feedback.list, {});
  expect(named.who).toBe("Matt West");
});
