import { action, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { requireOrg } from "../lib/auth";
import { chatJson, truncateInput } from "../lib/llm";
import { AI_MODEL } from "../lib/ai";
import { CheckIssue, checkProposalValidator } from "../lib/agentProposals";
import { Id } from "../_generated/dataModel";

export const getSheetContext = internalQuery({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org } = await requireOrg(ctx);
    const day = await ctx.db.get(args.shootDayId);
    if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
    const sheet = await ctx.db
      .query("callSheets")
      .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", args.shootDayId))
      .order("desc")
      .first();
    if (!sheet) throw new Error("No call sheet for this shoot day yet");
    const recipients = await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", args.shootDayId))
      .take(200);
    return {
      orgId: org._id,
      data: sheet.data,
      weather: day.weather ?? null,
      recipientSummary: recipients.map((r) => ({ name: r.name, status: r.status })),
    };
  },
});

export const insertRun = internalMutation({
  args: {
    orgId: v.id("organisations"),
    shootDayId: v.id("shootDays"),
    input: v.string(),
    proposal: checkProposalValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      orgId: args.orgId,
      shootDayId: args.shootDayId,
      agent: "call_sheet_checker",
      model: AI_MODEL,
      input: args.input,
      proposal: args.proposal,
      status: "advisory",
    });
  },
});

const SEVERITIES = new Set(["high", "medium", "low"]);

function validateIssues(raw: unknown): CheckIssue[] {
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o?.issues) ? o.issues : [];
  return list
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.message === "string" && (i.message as string).trim() !== "")
    .map((i) => ({
      severity: SEVERITIES.has(i.severity as string)
        ? (i.severity as CheckIssue["severity"])
        : ("low" as const),
      message: (i.message as string).trim(),
      suggestion:
        typeof i.suggestion === "string" && (i.suggestion as string).trim() !== ""
          ? (i.suggestion as string).trim()
          : undefined,
    }))
    .slice(0, 20);
}

export const run = action({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const context = await ctx.runQuery(internal.agents.callSheetChecker.getSheetContext, {
      shootDayId: args.shootDayId,
    });
    const today = new Date().toISOString().slice(0, 10);

    const system = `You are an experienced UK production manager reviewing a call sheet before it goes to crew. Today's date is ${today}.
Reply with ONLY a JSON object: {"issues": [{"severity": "high"|"medium"|"low", "message": string, "suggestion": string or null}]}
Look for the things that actually bite on shoot days: missing or implausible call times, schedule gaps or overlaps, no lunch/breaks across a long day, crew without phone numbers, no key contacts, missing parking or access notes, no nearest A&E, weather risk for exterior work, missing or thin safety notes, unconfirmed or declined crew close to the day, anything contradictory.
Be specific and concise (one sentence per message). British English. If the sheet is genuinely solid, return {"issues": []} — do not invent problems.`;

    const user = JSON.stringify(
      {
        callSheet: context.data,
        weather: context.weather,
        recipients: context.recipientSummary,
      },
      null,
      1
    );
    const raw = await chatJson({ system, user, maxTokens: 6000 });
    const issues = validateIssues(raw);
    const runId: Id<"agentRuns"> = await ctx.runMutation(
      internal.agents.callSheetChecker.insertRun,
      {
        orgId: context.orgId,
        shootDayId: args.shootDayId,
        input: truncateInput(user),
        proposal: { kind: "check", issues },
      }
    );
    return { runId, issues };
  },
});
