import { Infer, v } from "convex/values";

export const scheduleBlockValidator = v.object({
  id: v.string(), // client-generated, stable across edits for React keys
  start: v.string(), // "HH:MM"
  end: v.optional(v.string()),
  title: v.string(),
  notes: v.optional(v.string()),
});

export const crewRowValidator = v.object({
  id: v.string(),
  personId: v.optional(v.id("people")),
  name: v.string(),
  role: v.string(),
  callTime: v.string(), // "HH:MM"; defaults to general call
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const contactRowValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: v.string(),
  phone: v.string(),
});

export const locationEntryValidator = v.object({
  id: v.string(),
  locationId: v.optional(v.id("locations")),
  name: v.string(),
  address: v.string(),
  w3w: v.optional(v.string()),
  parkingNotes: v.optional(v.string()),
  nearestHospital: v.optional(v.string()),
});

export const callSheetDataValidator = v.object({
  title: v.string(), // production title, defaults to project name
  date: v.string(), // "YYYY-MM-DD"
  generalCallTime: v.string(), // "HH:MM"
  productionCompany: v.string(),
  clientName: v.optional(v.string()),
  locations: v.array(locationEntryValidator),
  schedule: v.array(scheduleBlockValidator),
  crew: v.array(crewRowValidator),
  contacts: v.array(contactRowValidator),
  notes: v.optional(v.string()),
  safetyNotes: v.optional(v.string()),
  weatherSummary: v.optional(v.string()),
  sunrise: v.optional(v.string()),
  sunset: v.optional(v.string()),
});

export type CallSheetData = Infer<typeof callSheetDataValidator>;
export type ScheduleBlock = Infer<typeof scheduleBlockValidator>;
export type CrewRow = Infer<typeof crewRowValidator>;
export type ContactRow = Infer<typeof contactRowValidator>;
export type LocationEntry = Infer<typeof locationEntryValidator>;
