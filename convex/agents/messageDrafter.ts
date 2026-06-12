import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { requireOrg } from "../lib/auth";
import { chatJson, truncateInput } from "../lib/llm";
import { AI_MODEL } from "../lib/ai";
import { escapeHtml, formatEmailDate } from "../lib/email";
import { MessageProposal } from "../lib/agentProposals";
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";

const UNCONFIRMED = new Set(["pending", "sent", "viewed", "failed"]);
const FROM = "UnitDeck <callsheets@updates.boostkit.io>";

async function chaseContext(ctx: QueryCtx | MutationCtx, shootDayId: Id<"shootDays">) {
  const { org } = await requireOrg(ctx);
  const day = await ctx.db.get(shootDayId);
  if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
  const sheets = await ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", shootDayId))
    .order("desc")
    .take(20);
  const sent = sheets.find((s) => s.status === "sent");
  if (!sent) throw new Error("Send the call sheet first, then chase confirmations");
  const recipients = await ctx.db
    .query("recipients")
    .withIndex("by_shoot_day", (q) => q.eq("shootDayId", shootDayId))
    .take(200);
  const unconfirmed = recipients.filter((r) => UNCONFIRMED.has(r.status));
  return { org, day, sent, unconfirmed };
}

export const getChaseContext = internalQuery({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const { org, day, sent, unconfirmed } = await chaseContext(ctx, args.shootDayId);
    return {
      orgId: org._id,
      orgName: org.name,
      title: sent.data.title,
      date: day.date,
      unconfirmed: unconfirmed.map((r) => ({ name: r.name, role: r.role })),
    };
  },
});

export const insertRun = internalMutation({
  args: {
    orgId: v.id("organisations"),
    shootDayId: v.id("shootDays"),
    input: v.string(),
    proposal: v.object({ kind: v.literal("message"), subject: v.string(), body: v.string() }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      orgId: args.orgId,
      shootDayId: args.shootDayId,
      agent: "message_drafter",
      model: AI_MODEL,
      input: args.input,
      proposal: args.proposal,
      status: "proposed",
    });
  },
});

export const draft = action({
  args: { shootDayId: v.id("shootDays") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const context: {
      orgId: Id<"organisations">;
      orgName: string;
      title: string;
      date: string;
      unconfirmed: { name: string; role: string }[];
    } = await ctx.runQuery(internal.agents.messageDrafter.getChaseContext, {
      shootDayId: args.shootDayId,
    });
    if (context.unconfirmed.length === 0) {
      throw new Error("Everyone has already confirmed");
    }

    const system = `You draft short, warm, professional chase messages from a producer at ${context.orgName}, a UK video production company. First person singular ("I"), British English, no exclamation marks, no corporate filler, never mention AI.
Reply with ONLY a JSON object: {"subject": string, "body": string}
The body is plain text, 2-4 short sentences: remind them which shoot and date, ask them to confirm via their personal link (the link is appended automatically after your body, so do not write a URL or placeholder), and offer a way to flag problems. Do not address anyone by name (it goes to several people). Never use em dashes.`;

    const user = `Shoot: "${context.title}" on ${formatEmailDate(context.date)}.
Unconfirmed crew: ${context.unconfirmed.map((r) => `${r.name} (${r.role})`).join(", ")}.`;

    const raw = (await chatJson({ system, user, maxTokens: 4000 })) as Record<string, unknown>;
    if (typeof raw?.subject !== "string" || typeof raw?.body !== "string") {
      throw new Error("Model output missing subject or body");
    }
    const proposal: MessageProposal = {
      kind: "message",
      subject: raw.subject.trim(),
      body: raw.body.trim(),
    };
    const runId: Id<"agentRuns"> = await ctx.runMutation(
      internal.agents.messageDrafter.insertRun,
      {
        orgId: context.orgId,
        shootDayId: args.shootDayId,
        input: truncateInput(user),
        proposal,
      }
    );
    return { runId, proposal, unconfirmedCount: context.unconfirmed.length };
  },
});

export const approveAndSend = mutation({
  args: { runId: v.id("agentRuns"), subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== org._id || run.agent !== "message_drafter" || !run.shootDayId) {
      throw new Error("Run not found");
    }
    if (run.status !== "proposed") throw new Error("This draft has already been decided");
    if (args.subject.trim() === "" || args.body.trim() === "") {
      throw new Error("Subject and body are required");
    }
    const { sent, unconfirmed } = await chaseContext(ctx, run.shootDayId);
    if (unconfirmed.length === 0) throw new Error("Everyone has already confirmed");

    const sendIds: Id<"sends">[] = [];
    for (const r of unconfirmed) {
      sendIds.push(
        await ctx.db.insert("sends", {
          orgId: org._id,
          recipientId: r._id,
          callSheetId: sent._id,
          channel: "email",
          status: "pending",
        })
      );
    }
    await ctx.db.patch(args.runId, {
      status: "approved",
      decidedBy: identity.subject,
      decidedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.agents.messageDrafter.deliverChase, {
      sendIds,
      subject: args.subject.trim(),
      body: args.body.trim(),
    });
    return sendIds.length;
  },
});

export const reject = mutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const { identity, org } = await requireOrg(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== org._id) throw new Error("Run not found");
    if (run.status !== "proposed") throw new Error("This draft has already been decided");
    await ctx.db.patch(args.runId, {
      status: "rejected",
      decidedBy: identity.subject,
      decidedAt: Date.now(),
    });
    return null;
  },
});

function chaseHtml(body: string, setModeUrl: string): string {
  const paragraphs = body
    .split(/\n{2,}|\n/)
    .filter((p) => p.trim() !== "")
    .map((p) => `<p style="margin:0 0 12px;font-size:14px;color:#171717;">${escapeHtml(p)}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:28px;">
<tr><td>${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr><td style="border-radius:6px;background:#171717;">
<a href="${setModeUrl}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm on your call sheet</a>
</td></tr></table>
</td></tr></table></td></tr></table></body></html>`;
}

export const getSendRecipient = internalQuery({
  args: { sendId: v.id("sends") },
  handler: async (ctx, args) => {
    const send = await ctx.db.get(args.sendId);
    if (!send) return null;
    const recipient = await ctx.db.get(send.recipientId);
    if (!recipient) return null;
    return { recipient };
  },
});

/** Awaited per-recipient sends; outcomes persisted on the sends ledger. */
export const deliverChase = internalAction({
  args: { sendIds: v.array(v.id("sends")), subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const siteUrl = process.env.SITE_URL;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set in the Convex environment");
    if (!siteUrl) throw new Error("SITE_URL is not set in the Convex environment");

    for (const sendId of args.sendIds) {
      const payload: { recipient: Doc<"recipients"> } | null = await ctx.runQuery(
        internal.agents.messageDrafter.getSendRecipient,
        { sendId }
      );
      if (!payload) continue;
      const { recipient } = payload;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM,
            to: [recipient.email],
            subject: args.subject,
            html: chaseHtml(args.body, `${siteUrl}/s/${recipient.token}`),
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as { id: string };
          await ctx.runMutation(internal.distribution.recordSendResult, {
            sendId,
            ok: true,
            providerId: json.id,
          });
        } else {
          const text = await res.text();
          await ctx.runMutation(internal.distribution.recordSendResult, {
            sendId,
            ok: false,
            error: `Resend ${res.status}: ${text.slice(0, 500)}`,
          });
        }
      } catch (err) {
        await ctx.runMutation(internal.distribution.recordSendResult, {
          sendId,
          ok: false,
          error: err instanceof Error ? err.message : "Unknown send error",
        });
      }
    }
    return null;
  },
});
