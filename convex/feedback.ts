import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireOrg } from "./lib/auth";
import { displayName } from "./lib/personName";
import { escapeHtml, sendEmail } from "./lib/email";
import { Doc, Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** The feedback type discriminant — single source of truth for Convex validators. */
const feedbackTypeValidator = v.union(
  v.literal("missing"),
  v.literal("issue"),
  v.literal("idea"),
  v.literal("praise")
);

/** What the `list` query returns per row. Exported so the frontend can type
 *  its useQuery result without importing Doc<"feedback"> (which won't have the
 *  new optional fields until Convex codegen has run with the updated schema). */
export type FeedbackReply = {
  _id: Id<"feedbackReplies">;
  _creationTime: number;
  message: string;
  who: string;
  /** Whether the signed-in reader wrote it, which is who may edit it. */
  mine: boolean;
  edited: boolean;
};

export type FeedbackItem = {
  _id: Id<"feedback">;
  _creationTime: number;
  page: string;
  type: "missing" | "issue" | "idea" | "praise" | undefined;
  status: "open" | "addressed";
  message: string;
  who: string;
  mine: boolean;
  edited: boolean;
  replies: FeedbackReply[];
};

// ---------------------------------------------------------------------------
// Mutations / queries
// ---------------------------------------------------------------------------

/** Product feedback from inside the app. Stored first, then emailed to Matt. */
export const submit = mutation({
  args: {
    message: v.string(),
    page: v.string(),
    type: v.optional(feedbackTypeValidator),
  },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    if (args.message.trim().length < 5) {
      throw new Error("Write a sentence or two so the feedback is actionable");
    }
    const feedbackId = await ctx.db.insert("feedback", {
      orgId: org._id,
      userId: identity.subject,
      userName:
        typeof identity.name === "string" && identity.name.trim() !== ""
          ? identity.name
          : undefined,
      userEmail: typeof identity.email === "string" ? identity.email : undefined,
      orgName: org.name,
      message: args.message.trim(),
      page: args.page.slice(0, 200),
      type: args.type,
      status: "open",
    });
    await ctx.scheduler.runAfter(0, internal.feedback.notify, { feedbackId });
    return null;
  },
});

/**
 * All feedback for this org, newest first, each with its replies oldest first
 * — a thread reads down the page.
 *
 * Authors are resolved through the names people have set in UnitDeck rather
 * than through whatever was stamped on the row when it was written: somebody
 * who has since given themselves a name should not still read as an email
 * address on everything they have ever said.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<FeedbackItem[]> => {
    const { identity, org } = await requireOrg(ctx);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .order("desc")
      .collect();

    // Both read once for the whole page rather than per row.
    const profiles = await ctx.db
      .query("memberProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const replies = await ctx.db
      .query("feedbackReplies")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();

    const nameFor = (row: {
      userId: string;
      userName?: string;
      userEmail?: string;
    }) =>
      displayName({
        chosen: profiles.find((p) => p.userId === row.userId),
        // userName is one string (Clerk's `name`), not a first/last pair, so
        // it goes in whole — joinName returns it unchanged.
        fromAuth: row.userName ? { firstName: row.userName } : null,
        email: row.userEmail,
        fallback: "Someone",
      });

    const byFeedback = new Map<Id<"feedback">, FeedbackReply[]>();
    for (const reply of replies) {
      const bucket = byFeedback.get(reply.feedbackId) ?? [];
      bucket.push({
        _id: reply._id,
        _creationTime: reply._creationTime,
        message: reply.message,
        who: nameFor(reply),
        mine: reply.userId === identity.subject,
        edited: reply.editedAt !== undefined,
      });
      byFeedback.set(reply.feedbackId, bucket);
    }
    for (const bucket of byFeedback.values()) {
      bucket.sort((a, b) => a._creationTime - b._creationTime);
    }

    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      page: row.page,
      type: row.type,
      status: row.status ?? "open",
      message: row.message,
      who: nameFor(row),
      mine: row.userId === identity.subject,
      edited: row.editedAt !== undefined,
      replies: byFeedback.get(row._id) ?? [],
    }));
  },
});

/**
 * Rewrites your own feedback.
 *
 * Your own only: anyone on the account can mark a piece of feedback addressed,
 * because that is a statement about the product, but rewriting what somebody
 * said is putting words in their mouth. The edit is stamped so a thread where
 * a comment changed under a reply is readable.
 */
export const edit = mutation({
  args: { id: v.id("feedback"), message: v.string() },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Feedback not found");
    if (row.userId !== identity.subject) throw new Error("That is not yours to edit");
    const message = args.message.trim();
    if (message.length < 5) {
      throw new Error("Write a sentence or two so the feedback is actionable");
    }
    await ctx.db.patch(args.id, { message, editedAt: Date.now() });
    return null;
  },
});

/** Replies to a piece of feedback. */
export const reply = mutation({
  args: { feedbackId: v.id("feedback"), message: v.string() },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const parent = await ctx.db.get(args.feedbackId);
    if (!parent || parent.orgId !== org._id) throw new Error("Feedback not found");
    const message = args.message.trim();
    if (message.length === 0) throw new Error("Write something to reply with");
    return await ctx.db.insert("feedbackReplies", {
      orgId: org._id,
      feedbackId: args.feedbackId,
      userId: identity.subject,
      userName:
        typeof identity.name === "string" && identity.name.trim() !== ""
          ? identity.name
          : undefined,
      userEmail: typeof identity.email === "string" ? identity.email : undefined,
      message,
    });
  },
});

/** Rewrites your own reply. Your own only, for the reason `edit` gives. */
export const editReply = mutation({
  args: { id: v.id("feedbackReplies"), message: v.string() },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Reply not found");
    if (row.userId !== identity.subject) throw new Error("That is not yours to edit");
    const message = args.message.trim();
    if (message.length === 0) throw new Error("Write something to reply with");
    await ctx.db.patch(args.id, { message, editedAt: Date.now() });
    return null;
  },
});

/** Toggle the status of a feedback item. Org-scoped. */
export const setStatus = mutation({
  args: {
    id: v.id("feedback"),
    status: v.union(v.literal("open"), v.literal("addressed")),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Feedback not found");
    if (row.orgId !== org._id) throw new Error("Not authorised");
    await ctx.db.patch(args.id, { status: args.status });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internal helpers (unchanged)
// ---------------------------------------------------------------------------

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

    const who = row.userName ?? row.userEmail ?? row.userId;
    const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717;">
<p style="font-size:14px;"><strong>${escapeHtml(who)}</strong> (${escapeHtml(row.orgName)}) sent feedback from <code>${escapeHtml(row.page)}</code>:</p>
<blockquote style="margin:12px 0;padding:12px 16px;background:#f5f5f5;border-left:3px solid #171717;font-size:14px;white-space:pre-line;">${escapeHtml(row.message)}</blockquote>
</body></html>`;

    const sendResult = await sendEmail({
      apiKey,
      to: ["matt@boostkit.io"],
      subject: `UnitDeck feedback from ${row.orgName}`,
      html,
    });
    const emailStatus = sendResult.ok ? "sent" : sendResult.error;
    const recorded: null = await ctx.runMutation(internal.feedback.recordNotifyResult, {
      feedbackId: args.feedbackId,
      emailStatus,
    });
    return recorded;
  },
});

// Type used by the notify action's runQuery annotation above
export type FeedbackId = Id<"feedback">;
