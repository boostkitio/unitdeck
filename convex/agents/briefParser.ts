import { action, internalMutation, internalQuery, mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { requireOrg } from "../lib/auth";
import { chatJson, truncateInput } from "../lib/llm";
import { AI_MODEL } from "../lib/ai";
import { BriefProposal, briefProposalValidator } from "../lib/agentProposals";
import { Id } from "../_generated/dataModel";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const getOrgContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(100);
    return { orgId: org._id, clientNames: clients.map((c) => c.name) };
  },
});

export const insertRun = internalMutation({
  args: {
    orgId: v.id("organisations"),
    input: v.string(),
    proposal: briefProposalValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      orgId: args.orgId,
      agent: "brief_parser",
      model: AI_MODEL,
      input: args.input,
      proposal: args.proposal,
      status: "proposed",
    });
  },
});

function validateBriefShape(raw: unknown): BriefProposal {
  const o = raw as Record<string, unknown>;
  if (typeof o?.projectName !== "string" || o.projectName.trim() === "") {
    throw new Error("Model output missing projectName");
  }
  const shootDaysRaw = Array.isArray(o.shootDays) ? o.shootDays : [];
  const shootDays = shootDaysRaw
    .map((d) => d as Record<string, unknown>)
    .filter((d) => typeof d.date === "string" && DATE_RE.test(d.date))
    .map((d) => ({
      date: d.date as string,
      label:
        typeof d.label === "string" && d.label.trim() !== "" ? (d.label as string) : undefined,
    }));
  return {
    kind: "brief",
    projectName: o.projectName.trim(),
    clientName:
      typeof o.clientName === "string" && o.clientName.trim() !== ""
        ? o.clientName.trim()
        : undefined,
    briefSummary:
      typeof o.briefSummary === "string" && o.briefSummary.trim() !== ""
        ? o.briefSummary.trim()
        : undefined,
    shootDays,
  };
}

export const run = action({
  args: { briefText: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (args.briefText.trim().length < 20) {
      throw new Error("Paste the brief text first — a sentence or two at minimum");
    }
    const context: { orgId: Id<"organisations">; clientNames: string[] } = await ctx.runQuery(
      internal.agents.briefParser.getOrgContext,
      {}
    );
    const today = new Date().toISOString().slice(0, 10);

    const system = `You extract structured production data from client briefs for a UK video production company. Today's date is ${today}.
Reply with ONLY a JSON object, no prose, in exactly this shape:
{"projectName": string, "clientName": string or null, "briefSummary": string, "shootDays": [{"date": "YYYY-MM-DD", "label": string or null}]}
Rules:
- projectName: a short working title a producer would recognise (e.g. "Acme spring brand film"), never the whole brief.
- clientName: the client company's name if identifiable, else null. Existing clients in the database: ${context.clientNames.length > 0 ? context.clientNames.join(", ") : "(none yet)"} — if the brief's client matches one of these, use the existing spelling exactly.
- briefSummary: 2-3 sentences, plain UK English, capturing deliverables, audience and any constraints.
- shootDays: ONLY dates the brief states or clearly implies (resolve relative dates like "next Thursday" against today's date). If no dates are given, return []. Never invent dates.
- label: a short description of the day if the brief gives one (e.g. "Interviews at head office"), else null.`;

    const raw = await chatJson({ system, user: args.briefText, maxTokens: 6000 });
    const proposal = validateBriefShape(raw);
    const runId: Id<"agentRuns"> = await ctx.runMutation(internal.agents.briefParser.insertRun, {
      orgId: context.orgId,
      input: truncateInput(args.briefText),
      proposal,
    });
    return { runId, proposal };
  },
});

export const approve = mutation({
  args: {
    runId: v.id("agentRuns"),
    projectName: v.string(),
    clientName: v.optional(v.string()),
    briefSummary: v.optional(v.string()),
    shootDays: v.array(v.object({ date: v.string(), label: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== org._id || run.agent !== "brief_parser") {
      throw new Error("Run not found");
    }
    if (run.status !== "proposed") throw new Error("This proposal has already been decided");
    if (args.projectName.trim() === "") throw new Error("Project name is required");
    for (const d of args.shootDays) {
      if (!DATE_RE.test(d.date)) throw new Error(`Invalid shoot day date: ${d.date}`);
    }

    // Match client case-insensitively; create only when genuinely new
    let clientId: Id<"clients"> | undefined;
    if (args.clientName && args.clientName.trim() !== "") {
      const wanted = args.clientName.trim().toLowerCase();
      const clients = await ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .take(200);
      const existing = clients.find((c) => c.name.toLowerCase() === wanted);
      clientId = existing
        ? existing._id
        : await ctx.db.insert("clients", { orgId: org._id, name: args.clientName.trim() });
    }

    const projectId = await ctx.db.insert("projects", {
      orgId: org._id,
      clientId,
      name: args.projectName.trim(),
      status: "brief",
      briefSummary: args.briefSummary,
    });
    for (const d of args.shootDays) {
      await ctx.db.insert("shootDays", {
        orgId: org._id,
        projectId,
        date: d.date,
        label: d.label,
        locationIds: [],
      });
    }

    await ctx.db.patch(args.runId, {
      status: "approved",
      decidedBy: identity.subject,
      decidedAt: Date.now(),
      projectId,
    });
    return projectId;
  },
});

export const reject = mutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== org._id) throw new Error("Run not found");
    if (run.status !== "proposed") throw new Error("This proposal has already been decided");
    await ctx.db.patch(args.runId, {
      status: "rejected",
      decidedBy: identity.subject,
      decidedAt: Date.now(),
    });
    return null;
  },
});
