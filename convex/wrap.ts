import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";

export const report = query({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    const project = await ctx.db.get(day.projectId);
    const recipients = await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", args.shootDayId))
      .take(200);
    return {
      date: day.date,
      label: day.label ?? null,
      projectName: project?.name ?? "",
      wrapNotes: day.wrapNotes ?? "",
      attendance: recipients.map((r) => ({
        name: r.name,
        role: r.role,
        callTime: r.callTime,
        status: r.status,
        checkInAt: r.checkInAt ?? null,
        safetyAckAt: r.safetyAckAt ?? null,
      })),
    };
  },
});

export const saveNotes = mutation({
  args: { shootDayId: v.id("shootDays"), notes: v.string() },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    await ctx.db.patch(args.shootDayId, { wrapNotes: args.notes });
    return null;
  },
});
