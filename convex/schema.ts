import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { callSheetDataValidator, invoicingValidator } from "./lib/callSheetData";
import { proposalValidator } from "./lib/agentProposals";
import { talentReleaseDataValidator } from "./lib/documentData";

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
        logoStorageId: v.optional(v.id("_storage")),
        invoicing: v.optional(invoicingValidator),
        confidentialByDefault: v.optional(v.boolean()),
      })
    ),
  }).index("by_clerk_org", ["clerkOrgId"]),

  clients: defineTable({
    orgId: v.id("organisations"),
    // The company. Existing rows were created when this was the only field.
    name: v.string(),
    // The first contact at that company, from when there could only be one.
    // Reads as the first entry in `contacts`; kept so existing rows still
    // carry the person whose details are on them.
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    // Everyone else you deal with there. A client of any size has a producer,
    // an accounts contact and someone who signs things off, and they are
    // rarely the same person.
    contacts: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.optional(v.string()),
          phone: v.optional(v.string()),
          email: v.optional(v.string()),
        })
      )
    ),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  people: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    // Which contact book they are in. Talent and crew are the same record —
    // a name, a role, contact details — kept in separate lists because that
    // is how a production office thinks about them. Absent reads as crew,
    // which is what every contact added before this is.
    kind: v.optional(v.union(v.literal("crew"), v.literal("talent"))),
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
    // Booking status. The first three are current; the rest are the old
    // pipeline statuses, kept valid so existing documents still pass schema
    // validation. Reads normalise them (convex/lib/projectStatus.ts) and
    // `projects.migrateStatuses` rewrites them, after which the legacy
    // literals can be dropped from this union.
    status: v.union(
      v.literal("not_booked"),
      v.literal("pencilled"),
      v.literal("confirmed"),
      v.literal("brief"),
      v.literal("pre_production"),
      v.literal("shooting"),
      v.literal("post"),
      v.literal("delivered"),
      v.literal("archived")
    ),
    // Archiving used to be a status, which made it impossible to know what a
    // project's booking state had been. It is its own flag now.
    archived: v.optional(v.boolean()),
    briefSummary: v.optional(v.string()),
    // Where the production is based. Individual shoot days can still carry
    // their own locations for call sheets; this is the project-level one.
    locationId: v.optional(v.id("locations")),
    // The company's own reference for the job, used in the URL in place of a
    // document id. A string rather than a number so a house scheme like
    // "KLX-0042" works as well as plain counting. Optional because projects
    // created before it exists have none until they are numbered.
    jobNumber: v.optional(v.string()),
    // Last forecast fetched for the project's shoot day at its location, so
    // the header can render straight away instead of hitting the weather
    // service on every view. `date` and `locationId` say what it is for, which
    // is how a stale one is spotted; `reason` says why there is no weather,
    // for a day beyond the forecast.
    forecast: v.optional(
      v.object({
        date: v.string(),
        locationId: v.id("locations"),
        fetchedAt: v.number(),
        reason: v.optional(v.string()),
        summary: v.optional(v.string()),
        tempMinC: v.optional(v.number()),
        tempMaxC: v.optional(v.number()),
        precipitationProbability: v.optional(v.number()),
        windMaxKph: v.optional(v.number()),
        sunrise: v.optional(v.string()),
        sunset: v.optional(v.string()),
      })
    ),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_org_and_job_number", ["orgId", "jobNumber"]),

  // Crew booked onto a production. `people` is the org-wide contact book; this
  // is the per-project booking, so one person can sit on several productions.
  // Contact details deliberately live on `people` and are not copied here.
  projectCrew: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    // Talent are booked exactly like crew — a person, a role, contact details
    // — so they are the same row with a different heading over it. Absent
    // reads as crew, which is what every existing booking is.
    kind: v.optional(v.union(v.literal("crew"), v.literal("talent"))),
    // Absent means the role is booked but nobody is in it yet — a reminder to
    // find someone. `role` is then required, since nothing else names the row.
    personId: v.optional(v.id("people")),
    // Role on this production. Absent means "use the person's default role".
    role: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Whether this booking is firm. Optional because bookings predate the
    // field; absent reads as pencilled, so nothing is silently treated as
    // confirmed that nobody has confirmed.
    status: v.optional(v.union(v.literal("pencilled"), v.literal("confirmed"))),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_project_and_person", ["projectId", "personId"]),

  // Any file attached to a production: releases, risk assessments, creative.
  // Deliberately separate from `documents`, which is the e-signature flow with
  // its own structured data and signer; these are plain uploads.
  projectFiles: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    title: v.string(),
    kind: v.union(
      v.literal("talent_release"),
      v.literal("location_release"),
      v.literal("risk_assessment"),
      v.literal("creative"),
      v.literal("other")
    ),
    fileId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    notes: v.optional(v.string()),
    uploadedBy: v.optional(v.string()), // Clerk subject
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"]),

  // Kit a production is taking out: a line per item, so each can be tracked
  // from "needed" to "confirmed" independently. Split into two lists by
  // `section` — the standard kit, and whatever is hired in on top.
  projectEquipment: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    item: v.string(),
    // Camera, Lighting, Sound, Grip… copied from the inventory when the kit
    // comes from there, typed by hand when it does not.
    dept: v.optional(v.string()),
    // The inventory item this line is, when it was picked from the kit list.
    // Absent for anything hired in or typed by hand. Kept so the picker can
    // show what is already on the production.
    equipmentId: v.optional(v.id("equipment")),
    // What this line costs the production. Mostly used on the hire-in list,
    // where the number is a real invoice rather than kit you already own.
    cost: v.optional(v.number()),
    quantity: v.optional(v.number()),
    notes: v.optional(v.string()),
    status: v.union(v.literal("needed"), v.literal("confirmed")),
    // Which of the project's two lists this line sits in. "equipment" is the
    // standard kit going out, usually pulled in from a package; "additional"
    // is hired in, or anything off a normal job. Optional because rows predate
    // the split — those read as "additional", which is the list they were
    // already showing in.
    section: v.optional(v.union(v.literal("equipment"), v.literal("additional"))),
    // Where this line came from, when it came from a package. Keeping the link
    // is what lets a change to the package reach the productions using it.
    // Absent on anything added by hand, and on rows written before packages
    // were linked.
    packageId: v.optional(v.id("equipmentPackages")),
    packageItemId: v.optional(v.id("equipmentPackageItems")),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_package", ["packageId"])
    .index("by_package_item", ["packageItemId"]),

  // The org's own kit inventory. Distinct from projectEquipment, which is what
  // a given production still needs to source.
  equipment: defineTable({
    orgId: v.id("organisations"),
    // Department the kit belongs to: Camera, Lighting, Sound, Grip…
    dept: v.optional(v.string()),
    item: v.string(),
    serialNumber: v.optional(v.string()),
    weightKg: v.optional(v.number()),
    valueNew: v.optional(v.number()),
    valueCurrent: v.optional(v.number()),
    countryOfManufacture: v.optional(v.string()),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  // A named bundle of kit — "Standard camera package" — so a production can
  // pull in a whole setup instead of listing every item by hand.
  equipmentPackages: defineTable({
    orgId: v.id("organisations"),
    name: v.string(),
    notes: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  // A package's contents live in their own table rather than an array on the
  // package: the list is unbounded, and every edit would otherwise rewrite the
  // whole document.
  equipmentPackageItems: defineTable({
    orgId: v.id("organisations"),
    packageId: v.id("equipmentPackages"),
    // Set when the line came from the inventory; absent for free-text entries
    // covering kit that is hired in rather than owned.
    equipmentId: v.optional(v.id("equipment")),
    item: v.string(),
    quantity: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_package", ["packageId"]),

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
    satNav: v.optional(v.string()),
    // The nearest tube/rail station, named on its own rather than buried in a
    // paragraph — it is the single thing crew look for when travelling in.
    nearestStation: v.optional(v.string()),
    // IANA zone for the coordinates, learned from the weather service. Kept so
    // sun times can be shown in local time for a date beyond the forecast.
    timezone: v.optional(v.string()),
    publicTransport: v.optional(v.string()),
    nearestPoliceStation: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  shootDays: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    date: v.string(), // "YYYY-MM-DD"
    label: v.optional(v.string()), // "Day 1: interviews"
    locationIds: v.array(v.id("locations")),
    weather: v.optional(weatherSnapshotValidator),
    sun: v.optional(v.object({ sunrise: v.string(), sunset: v.string() })),
    wrapNotes: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_date", ["orgId", "date"])
    .index("by_project", ["projectId"]),

  // The running order for a production: what happens when. Kept per project
  // rather than inside a call sheet, because the schedule exists long before
  // anyone drafts one and is useful on its own.
  scheduleItems: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    // Which shoot day this belongs to. Absent for something that applies to
    // the production generally rather than to one day.
    shootDayId: v.optional(v.id("shootDays")),
    // "07:00". Absent for an item whose time is not settled yet, which sorts
    // to the end of its day rather than the start.
    time: v.optional(v.string()),
    item: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_shoot_day", ["shootDayId"]),

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
  })
    .index("by_token", ["token"])
    // Powers the daily cleanup cron (convex/crons.ts)
    .index("by_expires", ["expiresAt"]),

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

  waitlist: defineTable({
    email: v.string(),
    source: v.string(), // which page captured it
  }).index("by_email", ["email"]),

  // Ephemeral renders for the public call sheet maker (no login, no storage)
  toolRenders: defineTable({
    token: v.string(),
    data: callSheetDataValidator,
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    // Powers the daily cleanup cron (convex/crons.ts)
    .index("by_expires", ["expiresAt"]),

  feedback: defineTable({
    orgId: v.id("organisations"),
    userId: v.string(), // Clerk subject
    userName: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    orgName: v.string(),
    message: v.string(),
    page: v.string(), // app path the feedback was sent from
    emailStatus: v.optional(v.string()), // "sent" or the error
    type: v.optional(
      v.union(
        v.literal("missing"),
        v.literal("issue"),
        v.literal("idea"),
        v.literal("praise")
      )
    ),
    status: v.optional(v.union(v.literal("open"), v.literal("addressed"))),
  }).index("by_org", ["orgId"]),

  documents: defineTable({
    orgId: v.id("organisations"),
    projectId: v.optional(v.id("projects")),
    type: v.union(v.literal("talent_release")),
    title: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("declined"),
      v.literal("voided")
    ),
    data: talentReleaseDataValidator,
    signer: v.object({
      name: v.string(),
      email: v.string(),
      personId: v.optional(v.id("people")),
    }),
    signToken: v.string(),
    signature: v.optional(
      v.object({
        typedName: v.string(),
        drawnImage: v.optional(v.string()),
        consent: v.literal(true),
        signedAt: v.number(),
        ip: v.optional(v.string()),
        userAgent: v.optional(v.string()),
      })
    ),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    viewedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    // Outcome of the invite email delivery; a document stays "sent" even when
    // the email failed (failure is a delivery attribute, not a doc status).
    inviteDelivery: v.optional(
      v.object({
        status: v.union(v.literal("delivered"), v.literal("failed")),
        error: v.optional(v.string()),
        at: v.number(),
      })
    ),
    signedPdfFileId: v.optional(v.id("_storage")),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_sign_token", ["signToken"]),
});
