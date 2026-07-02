import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { callSheetEmail, sendEmail } from "./lib/email";
import { Id } from "./_generated/dataModel";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const listForShootDay = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    return await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", args.shootDayId))
      .take(200);
  },
});

export const send = mutation({
  args: {
    shootDayId: v.id("shootDays"),
    recipients: v.array(
      v.object({
        name: v.string(),
        role: v.string(),
        email: v.string(),
        callTime: v.string(),
        personId: v.optional(v.id("people")),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    if (args.recipients.length === 0) throw new Error("At least one recipient is required");
    for (const r of args.recipients) {
      if (!EMAIL_RE.test(r.email)) throw new Error(`Invalid email: ${r.email}`);
      if (r.name.trim() === "") throw new Error("Recipient name is required");
    }

    // Freeze the draft as the sent version, open the next draft
    const versions = await ctx.db
      .query("callSheets")
      .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", args.shootDayId))
      .order("desc")
      .take(50);
    const draft = versions[0];
    if (!draft || draft.status !== "draft") throw new Error("No draft to send");
    // "Updated" only when crew have already received a version of this sheet
    const isUpdate = versions.some((s) => s.status === "sent");
    await ctx.db.patch(draft._id, { status: "sent", versionNote: "Sent to crew" });
    await ctx.db.insert("callSheets", {
      orgId: org._id,
      shootDayId: args.shootDayId,
      projectId: draft.projectId,
      version: draft.version + 1,
      status: "draft",
      data: draft.data,
    });

    // Upsert recipients by (shootDay, email); tokens survive re-sends
    const existing = await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", args.shootDayId))
      .take(200);
    const sendIds: Id<"sends">[] = [];
    for (const r of args.recipients) {
      const email = r.email.trim().toLowerCase();
      const found = existing.find((e) => e.email === email);
      let recipientId: Id<"recipients">;
      if (found) {
        await ctx.db.patch(found._id, {
          name: r.name.trim(),
          role: r.role.trim(),
          callTime: r.callTime,
          personId: r.personId,
          status: "pending",
          lastError: undefined,
        });
        recipientId = found._id;
      } else {
        recipientId = await ctx.db.insert("recipients", {
          orgId: org._id,
          shootDayId: args.shootDayId,
          personId: r.personId,
          name: r.name.trim(),
          role: r.role.trim(),
          email,
          callTime: r.callTime,
          token: newToken(),
          status: "pending",
        });
      }
      sendIds.push(
        await ctx.db.insert("sends", {
          orgId: org._id,
          recipientId,
          callSheetId: draft._id,
          channel: "email",
          status: "pending",
        })
      );
    }

    await ctx.scheduler.runAfter(0, internal.distribution.deliverEmails, {
      sendIds,
      isUpdate,
    });
    return draft._id;
  },
});

export const getSendPayload = internalQuery({
  args: { sendId: v.id("sends") },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return null;
    const recipient = await ctx.db.get(send.recipientId);
    const sheet = await ctx.db.get(send.callSheetId);
    if (!recipient || !sheet) return null;
    return { send, recipient, sheet };
  },
});

export const recordSendResult = internalMutation({
  args: {
    sendId: v.id("sends"),
    ok: v.boolean(),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return null;
    if (args.ok) {
      await ctx.db.patch(args.sendId, { status: "sent", providerId: args.providerId });
      await ctx.db.patch(send.recipientId, { status: "sent", sentAt: Date.now() });
    } else {
      await ctx.db.patch(args.sendId, { status: "failed", error: args.error });
      await ctx.db.patch(send.recipientId, { status: "failed", lastError: args.error });
    }
    return null;
  },
});

/**
 * Sends every email, awaited, one at a time. Each outcome is persisted
 * before the next send starts — a crash mid-batch leaves an accurate ledger
 * (engineering rule: no fire-and-forget sends, ever).
 */
export const deliverEmails = internalAction({
  args: { sendIds: v.array(v.id("sends")), isUpdate: v.boolean() },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set in the Convex environment");
    if (!siteUrl) throw new Error("SITE_URL is not set in the Convex environment");

    for (const sendId of args.sendIds) {
      const payload = await ctx.runQuery(internal.distribution.getSendPayload, { sendId });
      if (!payload) continue;
      const { recipient, sheet } = payload;
      const { subject, html } = callSheetEmail({
        data: sheet.data,
        recipientName: recipient.name,
        recipientCallTime: recipient.callTime,
        setModeUrl: `${siteUrl}/s/${recipient.token}`,
        isUpdate: args.isUpdate,
      });
      const result = await sendEmail({ apiKey, to: [recipient.email], subject, html });
      await ctx.runMutation(internal.distribution.recordSendResult, {
        sendId,
        ok: result.ok,
        providerId: result.ok ? result.id : undefined,
        error: result.ok ? undefined : result.error,
      });
    }
    return null;
  },
});
