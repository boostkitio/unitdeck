import { mutation, query, internalAction, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { talentReleaseDataValidator } from "./lib/documentData";
import { talentReleaseInviteEmail } from "./lib/email";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

const FROM = "UnitDeck <callsheets@mail.unitdeck.app>";

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function requireOwnedDoc(ctx: QueryCtx | MutationCtx, id: Id<"documents">) {
  const { org } = await requireOrg(ctx);
  const doc = await ctx.db.get(id);
  if (!doc || doc.orgId !== org._id) throw new Error("Document not found");
  return { org, doc };
}

export const create = mutation({
  args: { projectId: v.id("projects"), personId: v.optional(v.id("people")) },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    const person = args.personId ? await ctx.db.get(args.personId) : null;
    if (person && person.orgId !== org._id) throw new Error("Person not found");
    const talentName = person?.name ?? "";
    const talentEmail = person?.email;
    return await ctx.db.insert("documents", {
      orgId: org._id,
      projectId: args.projectId,
      type: "talent_release",
      title: talentName ? `Talent release: ${talentName}` : "Talent release",
      status: "draft",
      data: {
        talentName,
        talentEmail,
        talentPhone: person?.phone,
        producerName: "",
        productionCompany: org.name,
        productionTitle: project.name,
        governingLaw: "England and Wales",
      },
      signer: { name: talentName, email: talentEmail ?? "", personId: args.personId },
      signToken: newToken(),
    });
  },
});

export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.orgId !== org._id) return null;
    return doc;
  },
});

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(200);
    return docs.filter((d) => d.orgId === org._id);
  },
});

export const saveDraft = mutation({
  args: { id: v.id("documents"), data: talentReleaseDataValidator },
  handler: async (ctx, args) => {
    const { doc } = await requireOwnedDoc(ctx, args.id);
    if (doc.status !== "draft") throw new Error("Only a draft can be edited");
    await ctx.db.patch(args.id, { data: args.data, title: `Talent release: ${args.data.talentName || "unnamed"}` });
    return null;
  },
});

export const send = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { doc } = await requireOwnedDoc(ctx, args.id);
    if (doc.status !== "draft") throw new Error("Only a draft can be sent");
    if (!doc.signer.email) throw new Error("Add the signer's email before sending");
    await ctx.db.patch(args.id, { status: "sent", sentAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.documents.deliverInvite, { id: args.id });
    return null;
  },
});

export const getForInvite = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

export const deliverInvite = internalAction({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set in the Convex environment");
    if (!siteUrl) throw new Error("SITE_URL is not set in the Convex environment");
    const doc = await ctx.runQuery(internal.documents.getForInvite, { id: args.id });
    if (!doc) return;
    const { subject, html } = talentReleaseInviteEmail({
      talentName: doc.data.talentName || doc.signer.name,
      productionTitle: doc.data.productionTitle,
      productionCompany: doc.data.productionCompany,
      signUrl: `${siteUrl}/sign/${doc.signToken}`,
    });
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [doc.signer.email], subject, html }),
    });
  },
});
