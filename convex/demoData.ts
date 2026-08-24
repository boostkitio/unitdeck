import { mutation, internalMutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Id } from "./_generated/dataModel";
import { CallSheetData } from "./lib/callSheetData";

const DEMO_PROJECT = "Barclays Pension Advice";

export async function seedDemoDataForOrg(
  ctx: MutationCtx,
  orgId: Id<"organisations">
): Promise<{ seeded: boolean; projectId: Id<"projects"> }> {
  const existing = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const already = existing.find((p) => p.name === DEMO_PROJECT);
  if (already) return { seeded: false, projectId: already._id };

  const org = await ctx.db.get(orgId);
  await ctx.db.patch(orgId, {
    settings: {
      ...org?.settings,
      brandColor: org?.settings?.brandColor ?? "#11182F",
      confidentialByDefault: org?.settings?.confidentialByDefault ?? true,
      invoicing: org?.settings?.invoicing ?? {
        legalName: "Klaxon Studio Ltd",
        companyNumber: "15712401",
        vatNumber: "GB470025721",
        invoiceEmail: "invoices@klaxon.studio",
        receiptsNote: "Please keep and submit all receipts to Klaxon Studio.",
      },
    },
  });

  const clientId = await ctx.db.insert("clients", {
    orgId,
    name: "RAPP (Barclays)",
    notes: "Agency: RAPP. End client: Barclays.",
  });

  const crewPeople = [
    { name: "James England", role: "Producer", email: "producer@example.com", phone: "07700 900447" },
    { name: "Charlie Fox", role: "Director of Photography", email: "dp@example.com", phone: "07700 900988" },
    { name: "Matt Hill", role: "Camera Operator", email: "cam@example.com", phone: "07700 900076" },
    { name: "James Travis", role: "Camera Assistant", email: "ac@example.com", phone: "07700 900855" },
    { name: "Michael O'Donahue", role: "Sound Recordist", email: "sound@example.com", phone: "07700 900721" },
    { name: "Rozzie Roux", role: "Autocue Operator", email: "autocue@example.com", phone: "07700 900982" },
  ];
  const pid: Record<string, Id<"people">> = {};
  for (const p of crewPeople) pid[p.name] = await ctx.db.insert("people", { orgId, ...p });

  const locationId = await ctx.db.insert("locations", {
    orgId,
    name: "Bermondsey Loft",
    address: "3 Tanner St, London, SE1 3LE",
    parkingNotes: "Premier Inn Tower Bridge, 159 Tower Bridge Road, SE1 3LP",
    satNav: "SE1 3JT",
    publicTransport: "London Bridge 10 min walk; Bermondsey tube 20 min walk",
    nearestHospital: "St Thomas' A&E, Westminster Bridge Rd, SE1 7EH",
    nearestPoliceStation: "Southwark Police Station, 323 Borough High St, SE1 1JL",
  });

  const projectId = await ctx.db.insert("projects", {
    orgId,
    clientId,
    name: DEMO_PROJECT,
    status: "pencilled",
    briefSummary: "4x 15sec talking-head videos, versioned for 16:9, 1:1 and 9:16.",
  });

  const shootDayId = await ctx.db.insert("shootDays", {
    orgId,
    projectId,
    date: "2026-06-09",
    label: "Day 1: studio talking heads",
    locationIds: [locationId],
    sun: { sunrise: "04:44", sunset: "21:16" },
  });

  const data: CallSheetData = {
    title: DEMO_PROJECT,
    date: "2026-06-09",
    generalCallTime: "07:45",
    productionCompany: "Klaxon Studio",
    clientName: "RAPP (Barclays)",
    confidential: true,
    branding: { brandColor: "#11182F" },
    invoicing: {
      legalName: "Klaxon Studio Ltd",
      companyNumber: "15712401",
      vatNumber: "GB470025721",
      invoiceEmail: "invoices@klaxon.studio",
      receiptsNote: "Please keep and submit all receipts to Klaxon Studio.",
    },
    callTimes: [
      { id: "ct-crew", label: "Crew call", time: "07:45" },
      { id: "ct-agency", label: "Agency call", time: "08:00" },
      { id: "ct-client", label: "Client call", time: "08:45" },
      { id: "ct-talent", label: "Talent call", time: "09:45" },
    ],
    locations: [
      {
        id: "loc-1",
        locationId,
        name: "Bermondsey Loft",
        address: "3 Tanner St, London, SE1 3LE",
        parkingNotes: "Premier Inn Tower Bridge, 159 Tower Bridge Road, SE1 3LP",
        satNav: "SE1 3JT",
        publicTransport: "London Bridge 10 min walk; Bermondsey tube 20 min walk",
        nearestHospital: "St Thomas' A&E, Westminster Bridge Rd, SE1 7EH",
        nearestPoliceStation: "Southwark Police Station, 323 Borough High St, SE1 1JL",
      },
    ],
    schedule: [
      { id: "s1", start: "07:45", title: "Crew call and load in" },
      { id: "s2", start: "08:15", title: "Block through locations", notes: "Charlie, Adam, Francesco" },
      { id: "s3", start: "10:00", title: "Talent to set" },
      { id: "s4", start: "10:15", title: "RX: consolidation film #1" },
      { id: "s5", start: "11:30", title: "Reset, position #2 and wardrobe" },
      { id: "s6", start: "12:00", title: "RX: SIPP film #2" },
      { id: "s7", start: "13:15", title: "Lunch" },
      { id: "s8", start: "14:30", title: "RX: time is your advantage #3" },
      { id: "s9", start: "16:15", title: "RX: planning and advice #4" },
      { id: "s10", start: "17:00", title: "Talent, agency, client wrap" },
      { id: "s11", start: "18:00", title: "Hard out of location" },
    ],
    crew: [
      { id: "c1", personId: pid["James England"], name: "James England", role: "Producer", callTime: "07:45", email: "producer@example.com", phone: "07700 900447" },
      { id: "c2", personId: pid["Charlie Fox"], name: "Charlie Fox", role: "Director of Photography", callTime: "07:45", email: "dp@example.com", phone: "07700 900988" },
      { id: "c3", personId: pid["Matt Hill"], name: "Matt Hill", role: "Camera Operator", callTime: "07:45", email: "cam@example.com", phone: "07700 900076" },
      { id: "c4", personId: pid["James Travis"], name: "James Travis", role: "Camera Assistant", callTime: "07:45", email: "ac@example.com", phone: "07700 900855" },
      { id: "c5", personId: pid["Michael O'Donahue"], name: "Michael O'Donahue", role: "Sound Recordist", callTime: "08:30", email: "sound@example.com", phone: "07700 900721" },
      { id: "c6", personId: pid["Rozzie Roux"], name: "Rozzie Roux", role: "Autocue Operator", callTime: "08:30", email: "autocue@example.com", phone: "07700 900982" },
    ],
    crewSectionTitle: "Crew",
    contacts: [],
    contactSections: [
      {
        id: "sec-agency",
        title: "Agency",
        rows: [
          { id: "a1", name: "Adam Pretty", role: "Senior Producer", callTime: "08:00", email: "adam@example.com", phone: "07700 900963" },
          { id: "a2", name: "Neil Williamson", role: "RAPP", email: "neil@example.com", reportsTo: "Adam Pretty" },
          { id: "a3", name: "Francesco Perillo", role: "RAPP", email: "fran@example.com", reportsTo: "Adam Pretty" },
        ],
      },
      {
        id: "sec-client",
        title: "Client",
        rows: [
          { id: "cl1", name: "Pauline Howard", role: "Barclays", callTime: "08:45", email: "pauline@example.com" },
          { id: "cl2", name: "Joyce Chen", role: "Barclays", callTime: "08:45", email: "joyce@example.com" },
          { id: "cl3", name: "Adrian Richards", role: "Barclays", callTime: "08:45", email: "adrian@example.com" },
        ],
      },
      {
        id: "sec-contrib",
        title: "Contributors",
        rows: [{ id: "t1", name: "Claire Francis", role: "Talent", callTime: "09:45", email: "claire@example.com" }],
      },
    ],
    camera: {
      recordingFormat: "3840 x 2160, S-Gamut3.Cine / S-Log3",
      frameRate: "25fps / PAL",
      aspectRatios: "9:16 and 1:1",
      namingConvention: "26MMDD_prodtitle_camA_001_",
      otherNotes: "PTCs, 2x camera setup, lapel + boom, 4x client IEMs. Time-of-day timecode, record on-camera sound.",
    },
    equipment: [
      { id: "e1", supplier: "Klaxon Studio", item: "Sony FX9 (x2)" },
      { id: "e2", supplier: "Klaxon Studio", item: "Sony FX6 or FX3" },
      { id: "e3", supplier: "Klaxon Studio", item: "Sigma Cine Prime set: 14, 24, 25, 50, 85, 135mm" },
      { id: "e4", supplier: "Klaxon Studio", item: "Prosup 2.9m slider" },
      { id: "e5", supplier: "Klaxon Studio", item: "Aputure 600d + 150cm dome; 300d + 90cm dome" },
      { id: "e6", supplier: "Klaxon Studio", item: "Blackmagic ATEM Pro, Atomos + ProHD client monitors" },
      { id: "e7", supplier: "Michael O'Donahue", item: "Sound kit: lapel + booms, 4x IEMs, 2x TC boxes" },
    ],
    notes:
      "Extremely time-dependent shoot with a hard out of the location at 18:00. Bring reusable water bottles. Snacks on set; lunch via Deliveroo. Take extra care of the property, damages are chargeable.",
    safetyNotes:
      "All cables to be taped down. In an emergency call 999. Nearest A&E: St Thomas'. First aid kit on set. Report any accidents to the producer.",
    sunrise: "04:44",
    sunset: "21:16",
  };

  await ctx.db.insert("callSheets", {
    orgId,
    shootDayId,
    projectId,
    version: 1,
    status: "draft",
    data,
  });

  return { seeded: true, projectId };
}

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const { org } = await requireOrg(ctx);
    return await seedDemoDataForOrg(ctx, org._id);
  },
});

export const seedDemoForOrg = internalMutation({
  args: { orgId: v.id("organisations") },
  handler: async (ctx, args) => {
    return await seedDemoDataForOrg(ctx, args.orgId);
  },
});
