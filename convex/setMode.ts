import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

const EXPIRY_DAYS_AFTER_SHOOT = 7;

async function recipientByToken(ctx: QueryCtx | MutationCtx, token: string) {
  return await ctx.db
    .query("recipients")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

function isExpired(shootDate: string): boolean {
  const [y, m, d] = shootDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const cutoff = Date.UTC(y, m - 1, d) + (EXPIRY_DAYS_AFTER_SHOOT + 1) * 24 * 60 * 60 * 1000;
  return Date.now() > cutoff;
}

async function latestSentSheet(
  ctx: QueryCtx | MutationCtx,
  shootDayId: Doc<"recipients">["shootDayId"]
) {
  const versions = await ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", shootDayId))
    .order("desc")
    .take(20);
  return versions.find((s) => s.status === "sent") ?? null;
}

/**
 * Public by token. Returns only what crew need: the sent document and their
 * own row's public fields. Never returns org ids or other recipients.
 */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const recipient = await recipientByToken(ctx, args.token);
    if (!recipient) return null;
    const day = await ctx.db.get(recipient.shootDayId);
    if (!day) return null;
    if (isExpired(day.date)) return { expired: true as const };
    const sheet = await latestSentSheet(ctx, recipient.shootDayId);
    if (!sheet) return null;
    return {
      expired: false as const,
      data: sheet.data,
      version: sheet.version,
      recipient: {
        name: recipient.name,
        role: recipient.role,
        callTime: recipient.callTime,
        status: recipient.status,
        safetyAckAt: recipient.safetyAckAt ?? null,
        checkInAt: recipient.checkInAt ?? null,
      },
    };
  },
});

async function liveRecipient(ctx: MutationCtx, token: string) {
  const recipient = await recipientByToken(ctx, token);
  if (!recipient) throw new Error("Unknown link");
  const day = await ctx.db.get(recipient.shootDayId);
  if (!day || isExpired(day.date)) throw new Error("This link has expired");
  return recipient;
}

export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    const patch: Record<string, unknown> = {};
    if (!r.viewedAt) patch.viewedAt = Date.now();
    // Only upgrade pending/sent → viewed; never downgrade confirmed/declined
    if (r.status === "pending" || r.status === "sent" || r.status === "failed") {
      patch.status = "viewed";
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(r._id, patch);
    return null;
  },
});

export const confirm = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (r.status === "confirmed") return null;
    await ctx.db.patch(r._id, { status: "confirmed", confirmedAt: Date.now() });
    return null;
  },
});

export const decline = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (r.status === "declined") return null;
    await ctx.db.patch(r._id, { status: "declined", declinedAt: Date.now() });
    return null;
  },
});

export const ackSafety = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (!r.safetyAckAt) await ctx.db.patch(r._id, { safetyAckAt: Date.now() });
    return null;
  },
});

export const checkIn = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const r = await liveRecipient(ctx, args.token);
    if (!r.checkInAt) await ctx.db.patch(r._id, { checkInAt: Date.now() });
    return null;
  },
});
