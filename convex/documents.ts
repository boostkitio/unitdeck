import { mutation, query, internalAction, internalMutation, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import {
  DEFAULT_LOCATION_RIGHTS_CLAUSE,
  DEFAULT_TALENT_RIGHTS_CLAUSE,
  documentDataValidator,
  releaseTitle,
  signerSubject,
} from "./lib/documentData";
import { talentReleaseInviteEmail, signedCopyEmail, sendEmail } from "./lib/email";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

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

/**
 * Whoever is producing, out of the crew already booked on the job.
 *
 * A release names the producer, and the production knows who that is — so
 * asking again is asking for something already on the page.
 */
async function producerOn(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">
): Promise<string> {
  const crew = await ctx.db
    .query("projectCrew")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(300);
  for (const row of crew) {
    if (!row.personId) continue;
    const person = await ctx.db.get(row.personId);
    if (!person) continue;
    const role = (row.role ?? person.role ?? "").toLowerCase();
    if (role.includes("producer")) return person.name;
  }
  return "";
}

/** The logo and house wording this company has settled on. */
async function releaseDefaults(
  ctx: MutationCtx,
  org: Doc<"organisations">,
  kind: "talent" | "location"
): Promise<{ logoUrl?: string; rightsClause: string }> {
  const logoUrl = org.settings?.logoStorageId
    ? ((await ctx.storage.getUrl(org.settings.logoStorageId)) ?? undefined)
    : undefined;
  const house =
    kind === "location"
      ? org.settings?.releaseWording?.location
      : org.settings?.releaseWording?.talent;
  const fallback =
    kind === "location" ? DEFAULT_LOCATION_RIGHTS_CLAUSE : DEFAULT_TALENT_RIGHTS_CLAUSE;
  // Copied onto the document rather than read when it is displayed: what was
  // signed has to stay what was signed, whatever settings say afterwards.
  return { logoUrl, rightsClause: house?.trim() || fallback };
}

export const create = mutation({
  args: { projectId: v.id("projects"), personId: v.optional(v.id("people")) },
  handler: async (ctx, args): Promise<Id<"documents">> => {
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
        kind: "talent" as const,
        talentName,
        talentEmail,
        talentPhone: person?.phone,
        producerName: await producerOn(ctx, args.projectId),
        productionCompany: org.name,
        productionTitle: project.name,
        governingLaw: "England and Wales",
        ...(await releaseDefaults(ctx, org, "talent")),
      },
      signer: { name: talentName, email: talentEmail ?? "", personId: args.personId },
      signToken: newToken(),
    });
  },
});

/**
 * The release for the location a production is shooting at.
 *
 * The same document as a talent release about a different subject, so it is
 * raised the same way and from what the project already knows: the location's
 * name and address, the production, the producer, and the shoot dates.
 */
export const ensureForLocation = mutation({
  args: { projectId: v.id("projects"), locationId: v.id("locations") },
  handler: async (ctx, args): Promise<Id<"documents">> => {
    const { org } = await requireOrg(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== org._id) throw new Error("Project not found");
    const location = await ctx.db.get(args.locationId);
    if (!location || location.orgId !== org._id) throw new Error("Location not found");

    const existing = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const mine = existing.find(
      (doc) =>
        doc.orgId === org._id &&
        doc.type === "location_release" &&
        doc.status !== "voided" &&
        doc.data.kind === "location" &&
        doc.data.locationName === location.name
    );
    if (mine) return mine._id;

    // The dates the production is actually there, written for a human.
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const dates = days.map((d) => d.date).sort();
    const shootDates =
      dates.length === 0
        ? undefined
        : dates.length === 1
          ? dates[0]
          : `${dates[0]} to ${dates[dates.length - 1]}`;

    const data = {
      kind: "location" as const,
      locationName: location.name,
      address: location.address,
      // Nobody has said who owns it yet; the producer fills that in.
      ownerName: "",
      shootDates,
      producerName: await producerOn(ctx, args.projectId),
      productionCompany: org.name,
      productionTitle: project.name,
      governingLaw: "England and Wales",
      ...(await releaseDefaults(ctx, org, "location")),
    };

    return await ctx.db.insert("documents", {
      orgId: org._id,
      projectId: args.projectId,
      type: "location_release",
      title: releaseTitle(data),
      status: "draft",
      data,
      signer: { name: "", email: "" },
      signToken: newToken(),
    });
  },
});

/**
 * The release for one person on one production, made if it does not exist.
 *
 * Addressed by the person rather than by document id so pressing the button
 * twice reopens the release rather than starting a second one — a talent with
 * two releases on a job is a question nobody wants at the point of signing.
 */
export const ensureForPerson = mutation({
  args: { projectId: v.id("projects"), personId: v.id("people") },
  handler: async (ctx, args): Promise<Id<"documents">> => {
    const { org } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(200);
    const mine = existing.find(
      (doc) =>
        doc.orgId === org._id &&
        doc.signer.personId === args.personId &&
        doc.status !== "voided"
    );
    if (mine) return mine._id;
    return await ctx.runMutation(api.documents.create, {
      projectId: args.projectId,
      personId: args.personId,
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
  args: { id: v.id("documents"), data: documentDataValidator },
  handler: async (ctx, args) => {
    const { doc } = await requireOwnedDoc(ctx, args.id);
    if (doc.status !== "draft") throw new Error("Only a draft can be edited");
    const subject = signerSubject(args.data);
    await ctx.db.patch(args.id, {
      data: args.data,
      title: releaseTitle(args.data),
      signer: {
        name: subject.name,
        email: subject.email ?? "",
        personId: doc.signer.personId,
      },
    });
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

export const recordInviteResult = internalMutation({
  args: { id: v.id("documents"), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) return null;
    await ctx.db.patch(args.id, {
      inviteDelivery: {
        status: args.ok ? ("delivered" as const) : ("failed" as const),
        error: args.error,
        at: Date.now(),
      },
    });
    return null;
  },
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
      talentName: signerSubject(doc.data).name || doc.signer.name,
      productionTitle: doc.data.productionTitle,
      productionCompany: doc.data.productionCompany,
      signUrl: `${siteUrl}/sign/${doc.signToken}`,
      kind: doc.data.kind === "location" ? "location" : "talent",
      reminder: doc.inviteDelivery?.status === "delivered",
    });
    const result = await sendEmail({ apiKey, to: [doc.signer.email], subject, html });
    if (!result.ok) console.error("Talent release invite send failed", result.error);
    await ctx.runMutation(internal.documents.recordInviteResult, {
      id: args.id,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
  },
});

/**
 * Send the invite again — after a failed delivery, or as a reminder to
 * somebody who has had it a week and not signed.
 *
 * The same path either way: what a reminder is, is the invite arriving a
 * second time. A signed or declined document is finished and is not chased.
 */
export const resendInvite = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { doc } = await requireOwnedDoc(ctx, args.id);
    if (doc.status !== "sent") throw new Error("Only a document waiting to be signed can be chased");
    if (!doc.signer.email) throw new Error("Add the signer's email before sending");
    await ctx.scheduler.runAfter(0, internal.documents.deliverInvite, { id: args.id });
    return null;
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
    consent: v.boolean(),
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
    if (args.consent !== true) throw new Error("You must agree to sign electronically");
    if (args.drawnImage && args.drawnImage.length > 600000) throw new Error("Signature image is too large");
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
    if (doc.status !== "sent") throw new Error("This document cannot be declined");
    await ctx.db.patch(doc._id, { status: "declined", declinedAt: Date.now(), declineReason: args.reason });
    return null;
  },
});

export const getForPrint = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc) return null;
    const sig = doc.signature;
    return {
      data: doc.data,
      signature: sig ? { typedName: sig.typedName, drawnImage: sig.drawnImage, signedAt: sig.signedAt } : null,
    };
  },
});

/**
 * Public by token, one-shot: once a signed PDF is stored it is the canonical
 * legal artifact, so no further upload URLs can be minted for the document.
 */
export const generateSignedUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed") throw new Error("Not signable");
    if (doc.signedPdfFileId) throw new Error("Signed PDF already stored");
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachSignedPdf = mutation({
  args: { token: v.string(), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed") throw new Error("Not signable");
    if (doc.signedPdfFileId) return null; // first stored PDF is canonical
    await ctx.db.patch(doc._id, { signedPdfFileId: args.fileId });
    if (doc.signer.email) {
      await ctx.scheduler.runAfter(0, internal.documents.deliverSignedCopy, { id: doc._id });
    }
    return null;
  },
});

/** Public by token: the stored signed PDF's URL, or null before it exists. */
export const getSignedPdfUrl = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await docByToken(ctx, args.token);
    if (!doc || doc.status !== "signed" || !doc.signedPdfFileId) return null;
    return await ctx.storage.getUrl(doc.signedPdfFileId);
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
      talentName: signerSubject(doc.data).name || doc.signer.name,
      productionTitle: doc.data.productionTitle,
      productionCompany: doc.data.productionCompany,
      viewUrl: `${siteUrl}/sign/${doc.signToken}`,
    });
    const to = [doc.signer.email].filter(Boolean) as string[];
    const result = await sendEmail({ apiKey, to, subject, html });
    // The signed copy is a courtesy email; log failures without failing the flow.
    if (!result.ok) console.error("Signed copy send failed", result.error);
  },
});
