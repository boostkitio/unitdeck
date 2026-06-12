import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { escapeHtml } from "./lib/email";
import { Doc, Id } from "./_generated/dataModel";

/** Product feedback from inside the app. Stored first, then emailed to Matt. */
export const submit = mutation({
  args: { message: v.string(), page: v.string() },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    if (args.message.trim().length < 5) {
      throw new Error("Write a sentence or two so the feedback is actionable");
    }
    const feedbackId = await ctx.db.insert("feedback", {
      orgId: org._id,
      userId: identity.subject,
      userName: typeof identity.name === "string" ? identity.name : undefined,
      orgName: org.name,
      message: args.message.trim(),
      page: args.page.slice(0, 200),
    });
    await ctx.scheduler.runAfter(0, internal.feedback.notify, { feedbackId });
    return null;
  },
});

export const getForNotify = internalQuery({
  args: { feedbackId: v.id("feedback") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.feedbackId);
  },
});

export const recordNotifyResult = internalMutation({
  args: { feedbackId: v.id("feedback"), emailStatus: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedbackId, { emailStatus: args.emailStatus });
    return null;
  },
});

export const notify = internalAction({
  args: { feedbackId: v.id("feedback") },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set in the Convex environment");
    const row: Doc<"feedback"> | null = await ctx.runQuery(internal.feedback.getForNotify, {
      feedbackId: args.feedbackId,
    });
    if (!row) return null;

    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717;">
<p style="font-size:14px;"><strong>${escapeHtml(row.userName ?? row.userId)}</strong> (${escapeHtml(row.orgName)}) sent feedback from <code>${escapeHtml(row.page)}</code>:</p>
<blockquote style="margin:12px 0;padding:12px 16px;background:#f5f5f5;border-left:3px solid #171717;font-size:14px;white-space:pre-line;">${escapeHtml(row.message)}</blockquote>
</body></html>`;

    let emailStatus: string;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "UnitDeck <callsheets@mail.unitdeck.app>",
          to: ["matt@boostkit.io"],
          subject: `UnitDeck feedback from ${row.orgName}`,
          html,
        }),
      });
      emailStatus = res.ok ? "sent" : `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
    } catch (err) {
      emailStatus = err instanceof Error ? err.message : "Unknown send error";
    }
    const result: null = await ctx.runMutation(internal.feedback.recordNotifyResult, {
      feedbackId: args.feedbackId,
      emailStatus,
    });
    return result;
  },
});

// Type used by the notify action's runQuery annotation above
export type FeedbackId = Id<"feedback">;
