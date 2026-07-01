import { mutation, query, internalAction, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { talentReleaseDataValidator } from "./lib/documentData";
import { talentReleaseInviteEmail, signedCopyEmail } from "./lib/email";
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

async function docByToken(ctx: QueryCtx | MutationCtx, token: string) {
  return await ctx.db
    .query("documents")
    .withIndex("by_sign_token", (q) => q.eq("signToken", token))
    .unique();
}

export const getBySignToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    return {
      status: doc.status,
      data: doc.data,
      signer: { name: doc.signer.name },
      signedAt: doc.signature?.signedAt ?? null,
    };
  },
});

export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    if (!doc.viewedAt && (doc.status === "sent")) {
      await ctx.db.patch(doc._id, { viewedAt: Date.now() });
    }
    return null;
  },
});

export const sign = mutation({
  args: {
    token: v.string(),
    typedName: v.string(),
    drawnImage: v.optional(v.string()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) throw new Error("Unknown link");
    if (doc.status === "signed") throw new Error("This document is already signed");
    if (doc.status !== "sent") throw new Error("This document cannot be signed");
    if (args.typedName.trim().length === 0) throw new Error("Type your full name to sign");
    await ctx.db.patch(doc._id, {
      status: "signed",
      signature: {
        typedName: args.typedName.trim(),
        drawnImage: args.drawnImage,
        consent: true as const,
        signedAt: Date.now(),
        ip: args.ip,
        userAgent: args.userAgent,
      },
    });
    return null;
  },
});

export const decline = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) throw new Error("Unknown link");
    if (doc.status === "signed") throw new Error("This document is already signed");
    await ctx.db.patch(doc._id, { status: "declined", declinedAt: Date.now(), declineReason: args.reason });
    return null;
  },
});

export const getForPrint = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    return { data: doc.data, signature: doc.signature ?? null };
  },
});

export const generateSignedUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed") throw new Error("Not signable");
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachSignedPdf = mutation({
  args: { token: v.string(), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed") throw new Error("Not signable");
    await ctx.db.patch(doc._id, { signedPdfFileId: args.fileId });
    if (doc.signer.email) {
      await ctx.scheduler.runAfter(0, internal.documents.deliverSignedCopy, { id: doc._id });
    }
    return null;
  },
});

export const deliverSignedCopy = internalAction({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey || !siteUrl) throw new Error("Email env not set");
    const doc = await ctx.runQuery(internal.documents.getForInvite, { id: args.id });
    if (!doc) return;
    const { subject, html } = signedCopyEmail({
      talentName: doc.data.talentName || doc.signer.name,
      productionTitle: doc.data.productionTitle,
      productionCompany: doc.data.productionCompany,
      viewUrl: `${siteUrl}/sign/${doc.signToken}`,
    });
    const to = [doc.signer.email].filter(Boolean) as string[];
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
  },
});
