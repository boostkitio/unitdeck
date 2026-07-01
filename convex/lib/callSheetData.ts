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
  reportsTo: v.optional(v.string()),
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
  satNav: v.optional(v.string()),
  publicTransport: v.optional(v.string()),
  nearestPoliceStation: v.optional(v.string()),
});

export const sectionRowValidator = v.object({
  id: v.string(),
  personId: v.optional(v.id("people")),
  name: v.string(),
  role: v.string(),
  callTime: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  reportsTo: v.optional(v.string()),
  notes: v.optional(v.string()),
});

export const contactSectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  rows: v.array(sectionRowValidator),
});

export const callTimeValidator = v.object({
  id: v.string(),
  label: v.string(),
  time: v.string(),
});

export const equipmentRowValidator = v.object({
  id: v.string(),
  supplier: v.optional(v.string()),
  item: v.string(),
});

export const cameraInfoValidator = v.object({
  recordingFormat: v.optional(v.string()),
  frameRate: v.optional(v.string()),
  aspectRatios: v.optional(v.string()),
  namingConvention: v.optional(v.string()),
  otherNotes: v.optional(v.string()),
});

export const invoicingValidator = v.object({
  legalName: v.optional(v.string()),
  companyNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  invoiceEmail: v.optional(v.string()),
  receiptsNote: v.optional(v.string()),
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
  callTimes: v.optional(v.array(callTimeValidator)),
  crewSectionTitle: v.optional(v.string()),
  contactSections: v.optional(v.array(contactSectionValidator)),
  camera: v.optional(cameraInfoValidator),
  equipment: v.optional(v.array(equipmentRowValidator)),
  branding: v.optional(
    v.object({ logoUrl: v.optional(v.string()), brandColor: v.optional(v.string()) })
  ),
  invoicing: v.optional(invoicingValidator),
  confidential: v.optional(v.boolean()),
});

export type CallSheetData = Infer<typeof callSheetDataValidator>;
export type ScheduleBlock = Infer<typeof scheduleBlockValidator>;
export type CrewRow = Infer<typeof crewRowValidator>;
export type ContactRow = Infer<typeof contactRowValidator>;
export type LocationEntry = Infer<typeof locationEntryValidator>;
export type SectionRow = Infer<typeof sectionRowValidator>;
export type ContactSection = Infer<typeof contactSectionValidator>;
export type CallTimeEntry = Infer<typeof callTimeValidator>;
export type EquipmentRow = Infer<typeof equipmentRowValidator>;
export type CameraInfo = Infer<typeof cameraInfoValidator>;

/**
 * One-way, idempotent migration: fold the deprecated flat `contacts[]` into a
 * "Key contacts" section so every group lives in `contactSections[]`. Safe to
 * call on already-migrated data (no-op when `contacts` is empty).
 */
export function migrateLegacyContacts(data: CallSheetData): CallSheetData {
  if (!data.contacts || data.contacts.length === 0) return data;
  const rows: SectionRow[] = data.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    phone: c.phone || undefined,
  }));
  const section: ContactSection = {
    id: `sec-legacy-${data.contacts[0].id}`,
    title: "Key contacts",
    rows,
  };
  return {
    ...data,
    contacts: [],
    contactSections: [...(data.contactSections ?? []), section],
  };
}
