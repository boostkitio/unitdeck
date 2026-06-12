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
