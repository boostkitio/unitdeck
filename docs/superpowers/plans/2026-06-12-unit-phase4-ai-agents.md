# Unit Phase 4: AI Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three AI agents — Brief Parser (client brief text → proposed project + shoot days as an approvable diff), Call Sheet Checker (advisory issue list on the composer), and Message Drafter (chase email for unconfirmed crew, approved before sending) — all running on OpenRouter `deepseek/deepseek-v4-flash` with every run logged in `agentRuns`.

**Architecture:** Agents are Convex actions that call OpenRouter via `fetch`, validate the model's JSON against typed proposal validators, and insert an `agentRuns` row with status `proposed` (or `advisory` for the read-only checker). They never mutate production data. Humans approve through separate mutations that apply the proposal transactionally and stamp `decidedBy`/`decidedAt`. The LLM plumbing (prompting for JSON, fence-stripping, parse-retry) lives in one helper so each agent file is mostly prompt + validation + apply logic.

**Tech Stack:** Existing stack. Model config from `convex/lib/ai.ts` (`AI_MODEL`, `OPENROUTER_BASE_URL`, `openRouterHeaders()`; key already in the Convex env, verified working). No new npm dependencies. DeepSeek v4 Flash is a reasoning model: prompts must budget `max_tokens` generously (4000+) because reasoning tokens spend first.

**Environment facts:**
- Convex CLI under Node 22 (`$env:Path = "C:\Users\itswe\node22;$env:Path"`).
- Live e2e uses the dev server on localhost:3001, signed in as matt+clerk_test@boostkit.io (code 424242). Chase-email test goes to matt@boostkit.io.
- Commits in Matt's voice, push after every task.

**Design decisions locked in:**
- The spec's `agentRuns.proposalDiff` is realised as a typed `proposal` union (one shape per agent), not freeform JSON — Convex validators reject malformed model output at the boundary.
- `approve` mutations take the **final values as arguments** (the UI lets the producer edit the proposal before approving), while the run row keeps the model's original proposal for the audit trail.
- The checker is advisory: it logs with status `advisory` and has no approve step.
- Chase emails append each recipient's personal set-mode link below the drafted body; the draft itself is link-free so one body serves all recipients.
- Brief Parser v1 accepts pasted text only (email threads, notes). PDF/deck upload needs file storage + extraction and is the documented fast-follow.

---

### Task 1: Schema — agentRuns + proposal validators

**Files:**
- Create: `convex/lib/agentProposals.ts`
- Modify: `convex/schema.ts`

- [ ] **Step 1: Create `convex/lib/agentProposals.ts`:**

```ts
import { Infer, v } from "convex/values";

export const briefProposalValidator = v.object({
  kind: v.literal("brief"),
  projectName: v.string(),
  clientName: v.optional(v.string()),
  briefSummary: v.optional(v.string()),
  shootDays: v.array(
    v.object({
      date: v.string(), // "YYYY-MM-DD"; only dates the brief states explicitly
      label: v.optional(v.string()),
    })
  ),
});

export const checkIssueValidator = v.object({
  severity: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  message: v.string(),
  suggestion: v.optional(v.string()),
});

export const checkProposalValidator = v.object({
  kind: v.literal("check"),
  issues: v.array(checkIssueValidator),
});

export const messageProposalValidator = v.object({
  kind: v.literal("message"),
  subject: v.string(),
  body: v.string(),
});

export const proposalValidator = v.union(
  briefProposalValidator,
  checkProposalValidator,
  messageProposalValidator
);

export type BriefProposal = Infer<typeof briefProposalValidator>;
export type CheckIssue = Infer<typeof checkIssueValidator>;
export type CheckProposal = Infer<typeof checkProposalValidator>;
export type MessageProposal = Infer<typeof messageProposalValidator>;
```

- [ ] **Step 2: Add the table to `convex/schema.ts`** (import `proposalValidator` from `./lib/agentProposals`, add after `sends`):

```ts
  agentRuns: defineTable({
    orgId: v.id("organisations"),
    projectId: v.optional(v.id("projects")),
    shootDayId: v.optional(v.id("shootDays")),
    agent: v.union(
      v.literal("brief_parser"),
      v.literal("call_sheet_checker"),
      v.literal("message_drafter")
    ),
    model: v.string(),
    input: v.string(), // what the model was shown (truncated to 20k chars)
    proposal: proposalValidator,
    status: v.union(
      v.literal("proposed"), // awaiting a human decision
      v.literal("advisory"), // read-only output, no decision needed
      v.literal("approved"),
      v.literal("rejected")
    ),
    decidedBy: v.optional(v.string()), // Clerk user id (identity.subject)
    decidedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_shoot_day", ["shootDayId"]),
```

- [ ] **Step 3: Push schema, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
git add convex/schema.ts convex/lib/agentProposals.ts
git commit -m "Add agentRuns table with typed proposal validators"
git push
```

### Task 2: LLM helper (JSON chat + extraction)

**Files:**
- Create: `convex/lib/llm.ts`
- Test: `convex/llm.test.ts`

- [ ] **Step 1: Write failing tests** at `convex/llm.test.ts` (pure-function tests for the extraction logic only; the network call is e2e-verified in Task 7):

```ts
/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { extractJson } from "./lib/llm";

describe("extractJson", () => {
  test("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  test("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("recovers JSON embedded in prose", () => {
    expect(
      extractJson('Here is the result you asked for:\n{"a": {"b": [1, 2]}}\nLet me know!')
    ).toEqual({ a: { b: [1, 2] } });
  });

  test("throws a useful error on garbage", () => {
    expect(() => extractJson("no json here at all")).toThrow("No JSON object found");
  });
});
```

- [ ] **Step 2: Run to verify failure:** `npm test` — `./lib/llm` does not exist.

- [ ] **Step 3: Implement `convex/lib/llm.ts`:**

```ts
import { AI_MODEL, OPENROUTER_BASE_URL, openRouterHeaders } from "./ai";

/**
 * Pull the first JSON object out of a model response: handles bare JSON,
 * ```json fences, and JSON embedded in prose. Throws if nothing parses.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * One JSON-producing chat completion. Reasoning models spend tokens thinking
 * before they answer, so maxTokens is a hard floor of 4000. One automatic
 * retry on unparseable output, with the parse error fed back to the model.
 */
export async function chatJson(args: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<unknown> {
  const maxTokens = Math.max(args.maxTokens ?? 4000, 4000);

  async function once(messages: Array<{ role: string; content: string }>) {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices[0]?.message?.content ?? "";
    if (content.trim() === "") throw new Error("Model returned an empty response");
    return content;
  }

  const messages = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];
  const first = await once(messages);
  try {
    return extractJson(first);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unparseable";
    const retry = await once([
      ...messages,
      { role: "assistant", content: first },
      {
        role: "user",
        content: `That response could not be parsed as JSON (${reason}). Reply again with ONLY the JSON object, no prose, no code fences.`,
      },
    ]);
    return extractJson(retry);
  }
}

/** Truncate agent input before storing it on the run row. */
export function truncateInput(text: string, max = 20000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}
```

- [ ] **Step 4: Run to verify pass:** `npm test` — all green.

- [ ] **Step 5: Commit and push**

```powershell
git add convex/lib/llm.ts convex/llm.test.ts
git commit -m "Add OpenRouter JSON chat helper with fence-stripping and retry"
git push
```

### Task 3: Brief Parser (Convex)

**Files:**
- Create: `convex/agents/briefParser.ts`
- Test: `convex/briefParser.test.ts`

**Contract:** `run({ briefText })` is an action: resolves the org, calls the model, validates the shape, inserts a `proposed` run, returns `{ runId, proposal }`. `approve({ runId, ...finalValues })` applies the (possibly edited) values: matches or creates the client by name, creates the project and shoot days, stamps the run. `reject({ runId })` stamps rejection. Approve/reject are TDD-tested with seeded runs; the action's LLM call is e2e-verified in Task 7.

- [ ] **Step 1: Write failing tests** at `convex/briefParser.test.ts`:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const runId = await ctx.db.insert("agentRuns", {
      orgId: orgA,
      agent: "brief_parser",
      model: "test-model",
      input: "We need a two-day brand film for Acme in late June…",
      proposal: {
        kind: "brief",
        projectName: "Acme brand film",
        clientName: "Acme",
        briefSummary: "Two-day brand film.",
        shootDays: [{ date: "2026-06-29", label: "Day 1" }],
      },
      status: "proposed",
    });
    return { orgA, runId };
  });
  return { t, ids, asA: t.withIdentity({ subject: "user_a", org_id: "org_a" }) };
}

test("approve creates client, project and shoot days, and stamps the run", async () => {
  const { t, ids, asA } = await setup();
  const projectId = await asA.mutation(api.agents.briefParser.approve, {
    runId: ids.runId,
    projectName: "Acme brand film (edited)",
    clientName: "Acme",
    briefSummary: "Two-day brand film.",
    shootDays: [{ date: "2026-06-29", label: "Day 1" }, { date: "2026-06-30" }],
  });
  const project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.name).toBe("Acme brand film (edited)"); // edited value wins
  expect(project?.clientName).toBe("Acme");
  const days = await asA.query(api.shootDays.listForProject, { projectId });
  expect(days).toHaveLength(2);
  const run = await t.run(async (ctx) => ctx.db.get(ids.runId));
  expect(run?.status).toBe("approved");
  expect(run?.decidedBy).toBe("user_a");
  expect(run?.projectId).toBe(projectId);
});

test("approve reuses an existing client case-insensitively", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("clients", { orgId: ids.orgA, name: "ACME" });
  });
  const projectId = await asA.mutation(api.agents.briefParser.approve, {
    runId: ids.runId,
    projectName: "P",
    clientName: "acme",
    shootDays: [],
  });
  const clients = await asA.query(api.clients.list, {});
  expect(clients).toHaveLength(1); // no duplicate created
  const project = await asA.query(api.projects.get, { id: projectId });
  expect(project?.clientName).toBe("ACME");
});

test("reject stamps the run and creates nothing", async () => {
  const { t, ids, asA } = await setup();
  await asA.mutation(api.agents.briefParser.reject, { runId: ids.runId });
  const run = await t.run(async (ctx) => ctx.db.get(ids.runId));
  expect(run?.status).toBe("rejected");
  expect(await asA.query(api.projects.list, {})).toHaveLength(0);
});

test("a decided run cannot be approved again, and cross-org is rejected", async () => {
  const { t, ids, asA } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("organisations", { name: "Org B", clerkOrgId: "org_b" });
  });
  const asB = t.withIdentity({ subject: "user_b", org_id: "org_b" });
  await expect(
    asB.mutation(api.agents.briefParser.reject, { runId: ids.runId })
  ).rejects.toThrow("Run not found");
  await asA.mutation(api.agents.briefParser.reject, { runId: ids.runId });
  await expect(
    asA.mutation(api.agents.briefParser.approve, {
      runId: ids.runId,
      projectName: "P",
      shootDays: [],
    })
  ).rejects.toThrow("already been decided");
});
```

- [ ] **Step 2: Run to verify failure:** `npm test` — `api.agents` missing.

- [ ] **Step 3: Implement `convex/agents/briefParser.ts`:**

```ts
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
      label: typeof d.label === "string" && d.label.trim() !== "" ? d.label : undefined,
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
```

- [ ] **Step 4: Run to verify pass:** `npm test` — all green.

- [ ] **Step 5: Deploy, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
git add convex/agents/briefParser.ts convex/briefParser.test.ts
git commit -m "Add brief parser agent with approve/reject proposal flow"
git push
```

### Task 4: Brief Parser UI ("New from brief")

**Files:**
- Create: `src/components/agents/brief-dialog.tsx`
- Modify: `src/app/(app)/projects/page.tsx` (add the button next to "New project")

- [ ] **Step 1: Create `src/components/agents/brief-dialog.tsx`.** Two-stage dialog: paste → review/edit → create.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { BriefProposal } from "../../../convex/lib/agentProposals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BriefDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const parse = useAction(api.agents.briefParser.run);
  const approve = useMutation(api.agents.briefParser.approve);
  const reject = useMutation(api.agents.briefParser.reject);

  const [briefText, setBriefText] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<Id<"agentRuns"> | null>(null);
  const [proposal, setProposal] = useState<BriefProposal | null>(null);

  async function runParse() {
    setBusy(true);
    try {
      const result = await parse({ briefText });
      setRunId(result.runId);
      setProposal(result.proposal);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse the brief.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (runId) await reject({ runId });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void discard()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{proposal ? "Review the proposal" : "New project from a brief"}</DialogTitle>
        </DialogHeader>

        {!proposal ? (
          <>
            <div className="space-y-2">
              <p className="text-sm text-neutral-500">
                Paste the client&apos;s email thread, notes or brief. You review everything before
                anything is created.
              </p>
              <Textarea
                rows={10}
                placeholder="Hi Matt, we're after a 2-minute brand film…"
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || briefText.trim().length < 20} onClick={runParse}>
                {busy ? "Reading the brief…" : "Parse brief"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <ProposalReview
            proposal={proposal}
            busy={busy}
            onDiscard={discard}
            onApprove={async (final) => {
              setBusy(true);
              try {
                const projectId = await approve({ runId: runId!, ...final });
                toast.success("Project created from the brief.");
                onClose();
                router.push(`/projects/${projectId}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not create the project.");
                setBusy(false);
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposalReview({
  proposal,
  busy,
  onApprove,
  onDiscard,
}: {
  proposal: BriefProposal;
  busy: boolean;
  onApprove: (final: {
    projectName: string;
    clientName?: string;
    briefSummary?: string;
    shootDays: { date: string; label?: string }[];
  }) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [projectName, setProjectName] = useState(proposal.projectName);
  const [clientName, setClientName] = useState(proposal.clientName ?? "");
  const [briefSummary, setBriefSummary] = useState(proposal.briefSummary ?? "");
  const [days, setDays] = useState(proposal.shootDays);

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bp-name">Project name</Label>
          <Input id="bp-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bp-client">Client</Label>
          <Input
            id="bp-client"
            placeholder="Leave blank for no client"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bp-summary">Brief summary</Label>
          <Textarea
            id="bp-summary"
            rows={3}
            value={briefSummary}
            onChange={(e) => setBriefSummary(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Shoot days</Label>
          {days.length === 0 ? (
            <p className="text-sm text-neutral-500">No dates found in the brief.</p>
          ) : (
            days.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="date"
                  className="w-40"
                  value={d.date}
                  onChange={(e) =>
                    setDays(days.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))
                  }
                />
                <Input
                  placeholder="Label"
                  value={d.label ?? ""}
                  onChange={(e) =>
                    setDays(
                      days.map((x, j) =>
                        j === i ? { ...x, label: e.target.value || undefined } : x
                      )
                    )
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => setDays(days.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => void onDiscard()}>
          Discard
        </Button>
        <Button
          disabled={busy || projectName.trim() === ""}
          onClick={() =>
            void onApprove({
              projectName,
              clientName: clientName.trim() || undefined,
              briefSummary: briefSummary.trim() || undefined,
              shootDays: days,
            })
          }
        >
          {busy ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </>
  );
}
```

- [ ] **Step 2: Add the button to the projects page.** In `src/app/(app)/projects/page.tsx`, import `BriefDialog`, add `const [briefOpen, setBriefOpen] = useState(false);` beside the existing dialog state, render a secondary button next to "New project":

```tsx
<Button variant="secondary" onClick={() => setBriefOpen(true)}>
  New from brief
</Button>
```

and at the end of the page component: `{briefOpen && <BriefDialog onClose={() => setBriefOpen(false)} />}`.

- [ ] **Step 3: Build, commit, push**

```powershell
npm run build
git add src/components/agents/brief-dialog.tsx "src/app/(app)/projects/page.tsx"
git commit -m "Add new-from-brief flow with editable AI proposal review"
git push
```

### Task 5: Call Sheet Checker (Convex + composer panel)

**Files:**
- Create: `convex/agents/callSheetChecker.ts`
- Create: `src/components/agents/check-dialog.tsx`
- Modify: `src/app/(app)/projects/[id]/shoot-days/[shootDayId]/call-sheet/page.tsx` (toolbar button)

- [ ] **Step 1: Implement `convex/agents/callSheetChecker.ts`** (advisory: no approve step; run context gathered in one internal query):

```ts
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
    .filter((i) => typeof i.message === "string" && i.message.trim() !== "")
    .map((i) => ({
      severity: SEVERITIES.has(i.severity as string)
        ? (i.severity as CheckIssue["severity"])
        : "low",
      message: (i.message as string).trim(),
      suggestion:
        typeof i.suggestion === "string" && i.suggestion.trim() !== ""
          ? i.suggestion.trim()
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
```

- [ ] **Step 2: Create `src/components/agents/check-dialog.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { CheckIssue } from "../../../convex/lib/agentProposals";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const SEVERITY_STYLES: Record<CheckIssue["severity"], string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

export function CheckDialog({
  dayId,
  onClose,
}: {
  dayId: Id<"shootDays">;
  onClose: () => void;
}) {
  const check = useAction(api.agents.callSheetChecker.run);
  const [issues, setIssues] = useState<CheckIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    check({ shootDayId: dayId })
      .then((r) => {
        if (!cancelled) setIssues(r.issues);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Check failed.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Call sheet check</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : issues === null ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">Reviewing the sheet like a production manager would…</p>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        ) : issues.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nothing flagged. The sheet covers the essentials — worth a final human read before
            sending.
          </p>
        ) : (
          <ul className="max-h-96 space-y-3 overflow-y-auto">
            {issues.map((issue, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`mt-0.5 inline-flex h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[issue.severity]}`}
                >
                  {issue.severity}
                </span>
                <div>
                  <p className="text-sm">{issue.message}</p>
                  {issue.suggestion && (
                    <p className="mt-0.5 text-xs text-neutral-500">{issue.suggestion}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire into the composer toolbar** (`.../call-sheet/page.tsx`): import `CheckDialog`, add `const [checkOpen, setCheckOpen] = useState(false);`, add a ghost button before History:

```tsx
          <Button size="sm" variant="ghost" onClick={() => setCheckOpen(true)}>
            Check sheet
          </Button>
```

and alongside the other dialogs: `{checkOpen && <CheckDialog dayId={dayId} onClose={() => setCheckOpen(false)} />}`.

- [ ] **Step 4: Deploy, build, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
npm run build
git add convex/agents/callSheetChecker.ts src/components/agents/check-dialog.tsx "src/app/(app)/projects/[id]/shoot-days/[shootDayId]/call-sheet/page.tsx"
git commit -m "Add AI call sheet checker with severity-ranked advisory panel"
git push
```

### Task 6: Message Drafter (chase unconfirmed crew)

**Files:**
- Create: `convex/agents/messageDrafter.ts`
- Create: `src/components/agents/chase-dialog.tsx`
- Modify: `src/components/call-sheet/send-dialog.tsx` (add chase button to `RecipientStrip`)
- Test: `convex/messageDrafter.test.ts`

- [ ] **Step 1: Write failing tests** at `convex/messageDrafter.test.ts` (approve path with a seeded run; the draft action is e2e-verified):

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organisations", { name: "Org A", clerkOrgId: "org_a" });
    const projectA = await ctx.db.insert("projects", {
      orgId: orgA, name: "P", status: "pre_production",
    });
    const dayA = await ctx.db.insert("shootDays", {
      orgId: orgA, projectId: projectA, date: "2026-06-18", locationIds: [],
    });
    return { orgA, projectA, dayA };
  });
  const asA = t.withIdentity({ subject: "user_a", org_id: "org_a" });
  await asA.mutation(api.callSheets.ensure, { shootDayId: ids.dayA });
  await asA.mutation(api.distribution.send, {
    shootDayId: ids.dayA,
    recipients: [
      { name: "Sam", role: "Sound", email: "sam@example.test", callTime: "07:30" },
      { name: "Alex", role: "DP", email: "alex@example.test", callTime: "07:00" },
    ],
  });
  const runId = await t.run(async (ctx) =>
    ctx.db.insert("agentRuns", {
      orgId: ids.orgA,
      shootDayId: ids.dayA,
      agent: "message_drafter",
      model: "test-model",
      input: "chase context",
      proposal: { kind: "message", subject: "Please confirm", body: "Can you confirm for Thursday?" },
      status: "proposed",
    })
  );
  return { t, ids, asA, runId };
}

test("approveAndSend stamps the run and queues sends for unconfirmed recipients", async () => {
  const { t, ids, asA, runId } = await setup();
  // One of two confirms; the chase should target only the other
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  const sam = recipients.find((r) => r.name === "Sam")!;
  await t.mutation(api.setMode.confirm, { token: sam.token });

  const queued = await asA.mutation(api.agents.messageDrafter.approveAndSend, {
    runId,
    subject: "Please confirm (edited)",
    body: "Quick nudge — can you confirm?",
  });
  expect(queued).toBe(1); // only Alex
  const run = await t.run(async (ctx) => ctx.db.get(runId));
  expect(run?.status).toBe("approved");
  expect(run?.decidedBy).toBe("user_a");
});

test("approveAndSend refuses when no one is unconfirmed", async () => {
  const { t, asA, ids, runId } = await setup();
  const recipients = await asA.query(api.distribution.listForShootDay, { shootDayId: ids.dayA });
  for (const r of recipients) await t.mutation(api.setMode.confirm, { token: r.token });
  await expect(
    asA.mutation(api.agents.messageDrafter.approveAndSend, {
      runId, subject: "s", body: "b",
    })
  ).rejects.toThrow("Everyone has already confirmed");
});

test("reject stamps the run", async () => {
  const { t, asA, runId } = await setup();
  await asA.mutation(api.agents.messageDrafter.reject, { runId });
  const run = await t.run(async (ctx) => ctx.db.get(runId));
  expect(run?.status).toBe("rejected");
});
```

- [ ] **Step 2: Run to verify failure:** `npm test` — `api.agents.messageDrafter` missing.

- [ ] **Step 3: Implement `convex/agents/messageDrafter.ts`:**

```ts
import { action, internalAction, internalMutation, internalQuery, mutation } from "../_generated/server";
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
const FROM = "Unit <callsheets@updates.boostkit.io>";

async function chaseContext(ctx: QueryCtx | MutationCtx, shootDayId: Id<"shootDays">) {
  const { org } = await requireOrg(ctx);
  const day = await ctx.db.get(shootDayId);
  if (!day || day.orgId !== org._id) throw new Error("Shoot day not found");
  const sheet = await ctx.db
    .query("callSheets")
    .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", shootDayId))
    .order("desc")
    .take(20);
  const sent = sheet.find((s) => s.status === "sent");
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
    const context = await ctx.runQuery(internal.agents.messageDrafter.getChaseContext, {
      shootDayId: args.shootDayId,
    });
    if (context.unconfirmed.length === 0) {
      throw new Error("Everyone has already confirmed");
    }

    const system = `You draft short, warm, professional chase messages from a producer at ${context.orgName}, a UK video production company. First person singular ("I"), British English, no exclamation marks, no corporate filler, never mention AI.
Reply with ONLY a JSON object: {"subject": string, "body": string}
The body is plain text, 2-4 short sentences: remind them which shoot and date, ask them to confirm via their personal link (the link is appended automatically after your body — do not write a URL or placeholder), and offer a way to flag problems. Do not address anyone by name (it goes to several people).`;

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
            sendId, ok: true, providerId: json.id,
          });
        } else {
          const text = await res.text();
          await ctx.runMutation(internal.distribution.recordSendResult, {
            sendId, ok: false, error: `Resend ${res.status}: ${text.slice(0, 500)}`,
          });
        }
      } catch (err) {
        await ctx.runMutation(internal.distribution.recordSendResult, {
          sendId, ok: false, error: err instanceof Error ? err.message : "Unknown send error",
        });
      }
    }
    return null;
  },
});

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
```

Caveat for the engineer: `recordSendResult` marks the recipient `status: "sent"`, which would wrongly downgrade a `viewed` recipient back to `sent` after a chase. That is acceptable for v1 (both mean "not yet confirmed") — note it, don't fix it here.

- [ ] **Step 4: Run to verify pass:** `npm test` — all green.

- [ ] **Step 5: Create `src/components/agents/chase-dialog.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export function ChaseDialog({
  dayId,
  onClose,
}: {
  dayId: Id<"shootDays">;
  onClose: () => void;
}) {
  const draftChase = useAction(api.agents.messageDrafter.draft);
  const approveAndSend = useMutation(api.agents.messageDrafter.approveAndSend);
  const reject = useMutation(api.agents.messageDrafter.reject);

  const [runId, setRunId] = useState<Id<"agentRuns"> | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    draftChase({ shootDayId: dayId })
      .then((r) => {
        if (cancelled) return;
        setRunId(r.runId);
        setSubject(r.proposal.subject);
        setBody(r.proposal.body);
        setCount(r.unconfirmedCount);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Drafting failed.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId]);

  async function discard() {
    if (runId) {
      try {
        await reject({ runId });
      } catch {
        // already decided; nothing to do
      }
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void discard()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chase unconfirmed crew</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : runId === null ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">Drafting a nudge…</p>
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-500">
              Goes to the {count} unconfirmed {count === 1 ? "person" : "people"}, each with their
              personal call sheet link appended. Edit freely before sending.
            </p>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="chase-subject">Subject</Label>
                <Input
                  id="chase-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chase-body">Message</Label>
                <Textarea
                  id="chase-body"
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => void discard()}>
                Discard
              </Button>
              <Button
                disabled={busy || subject.trim() === "" || body.trim() === ""}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const queued = await approveAndSend({ runId, subject, body });
                    toast.success(`Chase sent to ${queued} ${queued === 1 ? "person" : "people"}.`);
                    onClose();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Send failed.");
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Sending…" : `Send to ${count}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Add the chase button to `RecipientStrip`** in `src/components/call-sheet/send-dialog.tsx`. Replace the component with:

```tsx
export function RecipientStrip({ dayId }: { dayId: Id<"shootDays"> }) {
  const recipients = useQuery(api.distribution.listForShootDay, { shootDayId: dayId });
  const [chaseOpen, setChaseOpen] = useState(false);
  if (!recipients || recipients.length === 0) return null;
  const unconfirmed = recipients.filter((r) =>
    ["pending", "sent", "viewed", "failed"].includes(r.status)
  ).length;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-6 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      {recipients.map((r) => {
        const s = STATUS_LABELS[r.status] ?? STATUS_LABELS.pending;
        return (
          <span
            key={r._id}
            title={r.lastError ?? undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}
          >
            {r.name}
            <span className="opacity-70">
              · {s.label}
              {r.checkInAt ? " · On set" : ""}
            </span>
          </span>
        );
      })}
      {unconfirmed > 0 && (
        <button
          className="ml-auto text-xs font-medium text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          onClick={() => setChaseOpen(true)}
        >
          Chase {unconfirmed} unconfirmed
        </button>
      )}
      {chaseOpen && <ChaseDialog dayId={dayId} onClose={() => setChaseOpen(false)} />}
    </div>
  );
}
```

with `import { ChaseDialog } from "@/components/agents/chase-dialog";` added at the top of the file.

- [ ] **Step 7: Deploy, build, commit, push**

```powershell
$env:Path = "C:\Users\itswe\node22;$env:Path"; npx convex dev --once
npm run build
git add convex/agents/messageDrafter.ts convex/messageDrafter.test.ts src/components/agents/chase-dialog.tsx src/components/call-sheet/send-dialog.tsx
git commit -m "Add AI chase drafter with approve-and-send for unconfirmed crew"
git push
```

### Task 7: Live e2e with the real model + verification pass

- [ ] **Step 1: Full suite + lint:** `npm test` and `npm run lint` — clean.
- [ ] **Step 2: Brief Parser live.** On localhost:3001 signed in as the test user: Projects → "New from brief" → paste a realistic brief (client name, deliverable, an explicit date like "shooting Thursday 25 June") → verify the proposal extracts name/client/summary/date sensibly → edit something → Create → verify project, client and shoot day exist and the run row in the Convex dashboard (`agentRuns`) is `approved` with `decidedBy` set. Date check rule applies: verify any weekday/date pairing in the test brief with `date -d` first.
- [ ] **Step 3: Checker live.** Open the test call sheet → "Check sheet" → verify a sensible issue list appears (the test sheet has no safety notes, no contacts and no phone number for Matt — expect flags) and a run logs as `advisory`.
- [ ] **Step 4: Drafter live.** Add an unconfirmed recipient if needed (re-send the sheet), then "Chase N unconfirmed" → verify the drafted message reads like Matt (first person singular, no AI tells, UK English) → Send → email arrives at matt@boostkit.io with the personal link appended; run `approved`; sends ledger rows recorded.
- [ ] **Step 5: `git status` clean and pushed; update the project memory file with phase 4 state.**
- [ ] **Step 6: Report**, flagging deferred items: PDF/deck upload for the Brief Parser, Risk Agent (first fast-follow per spec), AI credit metering for billing, checker auto-run before send.

---

**Self-review notes:** Spec coverage — section 3 AI v1: Brief Parser ✓ (text paste; file upload documented as deferred), Call Sheet Checker ✓ (advisory in composer, spec's "AI checklist right" rendered as a dialog rather than a third column — composer space is tight, noted as deliberate), Message Drafter ✓ (chase flow with approve-before-send). Section 4 architecture: agents are actions writing proposals, never direct mutations ✓; `agentRuns` stores prompt (input), proposal, decision, actor ✓ (sources field from the spec collapsed into `input` for v1). Type consistency: `BriefProposal`/`CheckIssue`/`MessageProposal` defined once in `agentProposals.ts` and imported everywhere; `approveAndSend(runId, subject, body)` matches tests, implementation and UI; `recordSendResult` reused from `internal.distribution` with the same signature as Phase 3. No placeholder steps; the one known imperfection (chase downgrades `viewed` → `sent`) is stated with rationale rather than hidden.
