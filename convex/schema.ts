import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
});
