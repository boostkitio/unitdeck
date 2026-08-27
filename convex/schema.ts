import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { callSheetDataValidator, invoicingValidator } from "./lib/callSheetData";
import { proposalValidator } from "./lib/agentProposals";
import { documentDataValidator, releaseWordingValidator } from "./lib/documentData";

/** The six headings a quote is totalled under, as the client sheet shows them. */
export const quoteCategoryValidator = v.union(
  v.literal("pre"),
  v.literal("production"),
  v.literal("art"),
  v.literal("equipment"),
  v.literal("travel"),
  v.literal("post")
);

/** What a rate is per. "generic" is a flat figure with nothing to multiply. */
export const quoteUnitValidator = v.union(
  v.literal("day"),
  v.literal("generic"),
  v.literal("track"),
  v.literal("mile"),
  v.literal("room"),
  v.literal("week"),
  v.literal("hour")
);

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
        // House wording for releases. A document keeps the clause it was
        // raised under, so changing this never rewrites one already signed.
        releaseWording: v.optional(releaseWordingValidator),
      })
    ),
  }).index("by_clerk_org", ["clerkOrgId"]),

  /**
   * How somebody on this account is named inside UnitDeck.
   *
   * Clerk holds a first and last name, but only renders and accepts them when
   * Name is enabled for the instance — a switch on the Clerk dashboard, not
   * something the app can set or reach. With it off, `user.update` is refused
   * outright, so a person could not be given a name from inside the product at
   * all. This table means the app owns the answer: the name is written here,
   * and Clerk's own name is a fallback for anyone who has one.
   *
   * Scoped to the organisation like everything else, so a name is never read
   * across a tenancy boundary. One row per person per account.
   */
  memberProfiles: defineTable({
    orgId: v.id("organisations"),
    // Clerk user id (identity.subject), which is what projects.ownerId holds.
    userId: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_user", ["orgId", "userId"]),

  /**
   * The rate card: what a thing costs us, per unit.
   *
   * Only the cost lives here. What a client is charged is worked out from it
   * and the margins on the quote — see convex/lib/quoteMath.ts — which is what
   * the spreadsheet did, and is why changing the profit margin re-prices the
   * whole card rather than needing 200 edits.
   */
  rateCardItems: defineTable({
    orgId: v.id("organisations"),
    category: quoteCategoryValidator,
    /** The finer grouping inside a category, as the rate card is laid out. */
    section: v.string(),
    name: v.string(),
    notes: v.optional(v.string()),
    unit: quoteUnitValidator,
    costPence: v.number(),
    sortOrder: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_category", ["orgId", "category"]),

  /**
   * A quote for a production.
   *
   * The margins live on the quote rather than on the account, because they are
   * negotiated per job: the same rate card goes out at x1.203 to one client
   * and x1.103 to another.
   */
  quotes: defineTable({
    orgId: v.id("organisations"),
    /**
     * The production this was quoted for, once there is one. Absent while the
     * job is still an enquiry: a quote is often what wins the work, so it has
     * to be able to exist before there is anything to attach it to.
     */
    projectId: v.optional(v.id("projects")),
    /** What to call it before a production gives it a name. */
    title: v.optional(v.string()),
    /** The house reference, e.g. "26_Ala_QV1". */
    number: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
      v.literal("declined")
    ),
    /** "Ballpark" or "Firm" — how much the figures should be relied on. */
    quoteType: v.optional(v.string()),
    // Who it is for. The names are captured as well as the link, because a
    // quote is a document: it should still read correctly when the client
    // record is renamed a year later.
    clientId: v.optional(v.id("clients")),
    clientName: v.optional(v.string()),
    clientContact: v.optional(v.string()),
    producerName: v.optional(v.string()),
    producerEmail: v.optional(v.string()),
    producerPhone: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    /** The caveats chosen for this quote, in the order they are printed. */
    caveats: v.optional(v.array(v.string())),
    // Margins in basis points, so 10% is 1000. Integers, for the same reason
    // money is in pence.
    contingencyBp: v.number(),
    profitBp: v.number(),
    insuranceBp: v.number(),
    vatBp: v.number(),
    /** What a derived rate is rounded up to. £5 in the sheet. */
    roundToPence: v.number(),
    discountPence: v.optional(v.number()),
    issuedAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"]),

  /**
   * A line on a quote.
   *
   * Both the cost and the rate are written down. The rate is a snapshot, not a
   * calculation: a quote that re-derived its rates would change under the
   * client every time somebody edited the rate card, which is the one thing a
   * sent quote must never do.
   */
  quoteLines: defineTable({
    orgId: v.id("organisations"),
    quoteId: v.id("quotes"),
    category: quoteCategoryValidator,
    section: v.optional(v.string()),
    name: v.string(),
    /** Internal note, never printed. */
    notes: v.optional(v.string()),
    /** Printed against the line on the client's copy. */
    clientNotes: v.optional(v.string()),
    unit: quoteUnitValidator,
    /** How many of them — people, cameras, rooms. */
    pax: v.number(),
    /** How many units each — days, miles, tracks. */
    unitAmount: v.number(),
    costPence: v.number(),
    ratePence: v.number(),
    /** Whether the rate was typed rather than derived, e.g. a pass-through. */
    rateOverridden: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_quote", ["quoteId"]),

  /**
   * A category total the producer has set by hand, to land the quote on a
   * round number. The difference from cost-plus-margins is absorbed by the
   * contingency, which is what the spreadsheet does.
   */
  quoteCategoryOverrides: defineTable({
    orgId: v.id("organisations"),
    quoteId: v.id("quotes"),
    category: quoteCategoryValidator,
    totalPence: v.number(),
  })
    .index("by_quote", ["quoteId"])
    .index("by_quote_category", ["quoteId", "category"]),

  /**
   * The house caveats, kept once and picked per quote. The spreadsheet held
   * these on their own tab with a tick box each, which is exactly the shape.
   */
  caveats: defineTable({
    orgId: v.id("organisations"),
    text: v.string(),
    /** Ticked by default on a new quote — "always include" in the sheet. */
    alwaysInclude: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

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
          // Stable identity, so a production can name one of these without
          // counting down the list. Absent on contacts written before there
          // were ids; the next write gives them one.
          id: v.optional(v.string()),
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
    // The member of this organisation who owns the production, by Clerk user
    // id — the person to ask when whoever booked it is away. A Clerk id
    // rather than a people row because this is a colleague with a login,
    // not a freelancer in the contacts book.
    ownerId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    // Which of the client's contacts booked the job, by position in that
    // client's contact list. A position rather than a name so correcting a
    // typo in the name does not quietly unset who booked it.
    bookedByContact: v.optional(v.number()),
    // Who booked it, by the contact's stable id. Supersedes the position
    // above, which is still read for projects set before ids existed.
    bookedByContactId: v.optional(v.string()),
    // Whether anyone has yet said which of the client's people are on this
    // job. Until they have, all of them are — and once they have, an empty
    // list means nobody, which is not the same thing.
    clientContactsChosen: v.optional(v.boolean()),
    // Which of the client's contacts are on this production, by the same
    // positions. Absent means nobody has pruned the list, so all of them are
    // — which is what it did before there was a choice. Taking one off writes
    // the list out in full, minus that one.
    clientContacts: v.optional(v.array(v.number())),
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

  // Which of a client's people are on a production. The client's book is the
  // company record, this is the booking — the same shape as projectCrew, and
  // for the same reason: taking somebody off a job must not reach the record.
  projectClients: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    clientId: v.id("clients"),
    /** The contact's stable id within that client. */
    contactId: v.string(),
    /**
     * What this person is on this job — "signs off the edit", "on set Tuesday
     * only". It belongs to the booking rather than to the client's book,
     * because it is true of this production and not of the next one.
     */
    notes: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"]),

  // Crew booked onto a production. `people` is the org-wide contact book; this
  // is the per-project booking, so one person can sit on several productions.
  // Contact details deliberately live on `people` and are not copied here.
  projectCrew: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    // Where this booking sits in the order crew are read out: director
    // first, camera together. One order for the production, because a
    // department list does not change between days. Absent sorts last, so
    // bookings made before the field keep working.
    sortOrder: v.optional(v.number()),
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
    // A location added for one job only. It stays attached to that production
    // but is kept out of the shared list, so a one-off address does not silt
    // up the database everyone picks from. Absent reads as shared, which is
    // what every location saved before this was.
    projectOnly: v.optional(v.boolean()),
    plusCode: v.optional(v.string()),
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
    // Overnight accommodation for this day. Per day rather than per
    // production: a job that moves changes hotel, and the crew reading
    // Tuesday's call sheet need Tuesday's hotel.
    accommodation: v.optional(
      v.object({
        name: v.string(),
        address: v.optional(v.string()),
        phone: v.optional(v.string()),
        checkIn: v.optional(v.string()),
        bookingRef: v.optional(v.string()),
        notes: v.optional(v.string()),
      })
    ),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_date", ["orgId", "date"])
    .index("by_project", ["projectId"]),

  /**
   * Where the unit sleeps on a production.
   *
   * A list rather than one hotel, because a job that moves books more than
   * one, and because "three nights at the Premier Inn then two at the Ibis"
   * is the shape the answer actually takes. Kept per production, alongside
   * the location, rather than inside a call sheet: it is booked long before
   * anyone drafts one and is read by whoever is doing the paying.
   */
  accommodation: defineTable({
    orgId: v.id("organisations"),
    projectId: v.id("projects"),
    /** The hotel. The one thing an entry cannot be without. */
    name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    /** Written for a person to read — "Mon 12 May, from 3pm". */
    checkIn: v.optional(v.string()),
    nights: v.optional(v.number()),
    /** Booking reference. A string: they are rarely just digits. */
    bookingRef: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
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
    // When the author last rewrote it. Absent means it stands as first written;
    // present is shown, because a thread where a comment changed underneath a
    // reply reads wrongly otherwise.
    editedAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]),

  /**
   * Replies on a piece of feedback, so it can be a conversation rather than a
   * suggestions box. Its own table rather than an array on the feedback row:
   * two people replying at once would otherwise overwrite each other, and a
   * reply needs its own author and its own edit history.
   */
  feedbackReplies: defineTable({
    orgId: v.id("organisations"),
    feedbackId: v.id("feedback"),
    userId: v.string(), // Clerk subject
    userName: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    message: v.string(),
    editedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_feedback", ["feedbackId"]),

  documents: defineTable({
    orgId: v.id("organisations"),
    projectId: v.optional(v.id("projects")),
    type: v.union(v.literal("talent_release"), v.literal("location_release")),
    title: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("declined"),
      v.literal("voided")
    ),
    data: documentDataValidator,
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
