import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { callSheetDataValidator } from "./lib/callSheetData";
import { proposalValidator } from "./lib/agentProposals";

export const weatherSnapshotValidator = v.object({
  fetchedAt: v.number(),
  summary: v.string(), // e.g. "Light rain"
  tempMinC: v.number(),
  tempMaxC: v.number(),
  precipitationProbability: v.optional(v.number()), // %
  windMaxKph: v.optional(v.number()),
});

export default defineSchema({
  organisations: defineTable({
    name: v.string(),
    clerkOrgId: v.string(),
    settings: v.optional(
      v.object({
        brandColor: v.optional(v.string()),
      })
    ),
  }).index("by_clerk_org", ["clerkOrgId"]),

  clients: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  people: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    // Free-text production role: "DP", "Sound recordist", "Editor", "Runner"
    role: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    dayRate: v.optional(v.number()),
    dietary: v.optional(v.string()),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_name", ["orgId", "name"]),

  projects: defineTable({
    orgId: v.id("organisations"),
    clientId: v.optional(v.id("clients")),
    name: v.string(),
    status: v.union(
      v.literal("brief"),
      v.literal("pre_production"),
      v.literal("shooting"),
      v.literal("post"),
      v.literal("delivered"),
      v.literal("archived")
    ),
    briefSummary: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"]),

  locations: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    address: v.string(),
    w3w: v.optional(v.string()),
    parkingNotes: v.optional(v.string()),
    accessNotes: v.optional(v.string()),
    nearestHospital: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  shootDays: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    date: v.string(), // "YYYY-MM-DD"
    label: v.optional(v.string()), // "Day 1: interviews"
    locationIds: v.array(v.id("locations")),
    weather: v.optional(weatherSnapshotValidator),
    sun: v.optional(v.object({ sunrise: v.string(), sunset: v.string() })),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"]),

  callSheets: defineTable({
    orgId: v.id("organisations"),
    shootDayId: v.id("shootDays"),
    projectId: v.id("projects"),
    version: v.number(), // 1, 2, 3...
    status: v.union(v.literal("draft"), v.literal("snapshot"), v.literal("sent")),
    data: callSheetDataValidator,
    pdfFileId: v.optional(v.id("_storage")),
    versionNote: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_shoot_day_and_version", ["shootDayId", "version"]),

  renderTokens: defineTable({
    callSheetId: v.id("callSheets"),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  recipients: defineTable({
    orgId: v.id("organisations"),
    shootDayId: v.id("shootDays"),
    personId: v.optional(v.id("people")),
    name: v.string(),
    role: v.string(),
    email: v.string(),
    callTime: v.string(), // "HH:MM"
    token: v.string(), // unguessable, powers the set mode link
    status: v.union(
      v.literal("pending"), // created/re-sent, email not yet accepted
      v.literal("sent"), // Resend accepted the email
      v.literal("failed"), // Resend rejected it; lastError set
      v.literal("viewed"), // opened their set mode page
      v.literal("confirmed"),
      v.literal("declined")
    ),
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
    checkInAt: v.optional(v.number()),
    safetyAckAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_shoot_day", ["shootDayId"])
    .index("by_token", ["token"]),

  sends: defineTable({
    orgId: v.id("organisations"),
    recipientId: v.id("recipients"),
    callSheetId: v.id("callSheets"), // the frozen version that went out
    channel: v.literal("email"),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    providerId: v.optional(v.string()), // Resend email id
    error: v.optional(v.string()),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_call_sheet", ["callSheetId"]),

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
});
