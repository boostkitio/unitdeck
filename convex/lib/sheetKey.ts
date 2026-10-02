import { Infer, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireOrg } from "./auth";

/**
 * Which call sheet is meant: one shoot day's own, or a production's combined
 * sheet covering several of its dates.
 *
 * The two are kept apart so a date can have a sheet of its own and still be
 * printed on the combined one. A combined sheet's rows carry the earliest of
 * its dates as `shootDayId`, which is what lets it be sent and checked like
 * any other — so every read by shoot day has to leave combined rows out, and
 * that is what these helpers are for.
 */
export const sheetKeyValidator = v.union(
  v.object({ shootDayId: v.id("shootDays") }),
  v.object({ combinedProjectId: v.id("projects") })
);
export type SheetKey = Infer<typeof sheetKeyValidator>;

/** The org check for a key, and the production it belongs to. */
export async function requireSheetKey(ctx: QueryCtx | MutationCtx, key: SheetKey) {
  const { org } = await requireOrg(ctx);
  if ("shootDayId" in key) {
    const day = await ctx.db.get(key.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    return { org, projectId: day.projectId, day };
  }
  const project = await ctx.db.get(key.combinedProjectId);
  if (!project || project.orgId !== org._id) throw new Error("Project not found");
  return { org, projectId: project._id, day: null };
}

/** The sheet's versions, newest first. */
export async function sheetVersions(
  ctx: QueryCtx | MutationCtx,
  key: SheetKey,
  limit: number
): Promise<Doc<"callSheets">[]> {
  if ("combinedProjectId" in key) {
    return await ctx.db
      .query("callSheets")
      .withIndex("by_project_and_combined_and_version", (q) =>
        q.eq("projectId", key.combinedProjectId).eq("combined", true)
      )
      .order("desc")
      .take(limit);
  }
  const out: Doc<"callSheets">[] = [];
  for await (const row of ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", key.shootDayId))
    .order("desc")) {
    if (row.combined) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** The open draft: the newest version, when it is still a draft. */
export async function sheetDraft(
  ctx: QueryCtx | MutationCtx,
  key: SheetKey
): Promise<Doc<"callSheets"> | null> {
  const [latest] = await sheetVersions(ctx, key, 1);
  return latest?.status === "draft" ? latest : null;
}

/** Everyone the sheet has been sent to. */
export async function sheetRecipients(
  ctx: QueryCtx | MutationCtx,
  key: SheetKey,
  limit: number
): Promise<Doc<"recipients">[]> {
  if ("combinedProjectId" in key) {
    return await ctx.db
      .query("recipients")
      .withIndex("by_combined_project", (q) => q.eq("combinedProjectId", key.combinedProjectId))
      .take(limit);
  }
  const out: Doc<"recipients">[] = [];
  for await (const row of ctx.db
    .query("recipients")
    .withIndex("by_shoot_day", (q) => q.eq("shootDayId", key.shootDayId))) {
    if (row.combinedProjectId) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** The key a recipient was sent under. */
export function recipientSheetKey(recipient: Doc<"recipients">): SheetKey {
  return recipient.combinedProjectId
    ? { combinedProjectId: recipient.combinedProjectId }
    : { shootDayId: recipient.shootDayId };
}
