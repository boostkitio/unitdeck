import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { callSheetDataValidator } from "./lib/callSheetData";

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
});
