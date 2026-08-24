import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Id } from "./_generated/dataModel";

export const KIND_LABELS: Record<string, string> = {
  talent_release: "Talent release",
  location_release: "Location release",
  risk_assessment: "Risk assessment",
  creative: "Creative",
  other: "Other",
};

const kindValidator = v.union(
  v.literal("talent_release"),
  v.literal("location_release"),
  v.literal("risk_assessment"),
  v.literal("creative"),
  v.literal("other")
);

export type ProjectFile = {
  _id: Id<"projectFiles">;
  title: string;
  kind: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
  notes: string | null;
  uploadedAt: number;
  url: string | null;
};

/** Files attached to a project, newest first, each with a fetchable URL. */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<ProjectFile[]> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) return [];

    const rows = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        title: row.title,
        kind: row.kind,
        fileName: row.fileName,
        contentType: row.contentType ?? null,
        size: row.size ?? null,
        notes: row.notes ?? null,
        uploadedAt: row._creationTime,
        url: await ctx.storage.getUrl(row.fileId),
      }))
    );
  },
});

/** Short-lived upload target. The client POSTs the file, then calls `attach`. */
export const generateUploadUrl = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    return await ctx.storage.generateUploadUrl();
  },
});

export const attach = mutation({
  args: {
    projectId: v.id("projects"),
    fileId: v.id("_storage"),
    title: v.string(),
    kind: kindValidator,
    fileName: v.string(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { org, identity } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    if (args.title.trim().length === 0) throw new Error("Give the document a title");

    return await ctx.db.insert("projectFiles", {
      orgId: org._id,
      projectId: args.projectId,
      title: args.title.trim(),
      kind: args.kind,
      fileId: args.fileId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      notes: args.notes?.trim() || undefined,
      uploadedBy: identity.subject,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projectFiles"),
    title: v.optional(v.string()),
    kind: v.optional(kindValidator),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Document not found");

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) {
      if (args.title.trim().length === 0) throw new Error("Give the document a title");
      patch.title = args.title.trim();
    }
    if (args.kind !== undefined) patch.kind = args.kind;
    if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;

    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projectFiles") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== org._id) throw new Error("Document not found");
    // The stored blob goes too: nothing else references it.
    await ctx.storage.delete(row.fileId);
    await ctx.db.delete(args.id);
    return null;
  },
});
