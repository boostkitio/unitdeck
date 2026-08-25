import { Infer, v } from "convex/values";

/**
 * The wording a release turns on.
 *
 * Kept here rather than in the component that draws it, because a company
 * edits it in settings, a document keeps the version it was signed under, and
 * the two have to agree about what the default was.
 */
export const DEFAULT_TALENT_RIGHTS_CLAUSE =
  "The Talent grants the Producer the right to photograph, film and record the Talent's voice and likeness for the Production, to make copies of those recordings, and to use the Talent's name and likeness for the promotion, advertising and distribution of the Production, in all media, worldwide, in perpetuity, unless otherwise stated above. The master recordings remain the property of the Producer. The Talent confirms they are over 18 and have authority to grant these rights. This agreement is governed by the law of {{governingLaw}}.";

export const DEFAULT_LOCATION_RIGHTS_CLAUSE =
  "The Owner grants the Producer permission to enter the Location with cast, crew and equipment on the dates stated above, and to photograph, film and record the Location, including its name, exterior and interior. The Producer may use those recordings for the Production and for its promotion, advertising and distribution, in all media, worldwide, in perpetuity, unless otherwise stated above. The Producer will leave the Location in the condition it was found and will make good any damage caused by the production. The Owner confirms they have authority to grant this permission. This agreement is governed by the law of {{governingLaw}}.";

/** The wording a company has settled on, when it has changed the default. */
export const releaseWordingValidator = v.object({
  talent: v.optional(v.string()),
  location: v.optional(v.string()),
});

export type ReleaseWording = Infer<typeof releaseWordingValidator>;

export const talentReleaseDataValidator = v.object({
  // Absent on every release written before there were two kinds, which were
  // all talent releases. That is what absence means.
  kind: v.optional(v.literal("talent")),
  talentName: v.string(),
  talentEmail: v.optional(v.string()),
  talentPhone: v.optional(v.string()),
  agentName: v.optional(v.string()),
  agentPhone: v.optional(v.string()),
  producerName: v.string(),
  productionCompany: v.string(),
  productionTitle: v.string(),
  compensation: v.optional(v.string()),
  additionalTerms: v.optional(v.string()),
  governingLaw: v.string(),
  // Copied onto the document when it is raised, not read live: what was
  // signed has to stay what was signed, whatever settings say later.
  rightsClause: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
});

export const locationReleaseDataValidator = v.object({
  kind: v.literal("location"),
  locationName: v.string(),
  address: v.string(),
  ownerName: v.string(),
  ownerEmail: v.optional(v.string()),
  ownerPhone: v.optional(v.string()),
  /** When the production is there, as written for a human to read. */
  shootDates: v.optional(v.string()),
  producerName: v.string(),
  productionCompany: v.string(),
  productionTitle: v.string(),
  compensation: v.optional(v.string()),
  additionalTerms: v.optional(v.string()),
  governingLaw: v.string(),
  rightsClause: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
});

export const documentDataValidator = v.union(
  talentReleaseDataValidator,
  locationReleaseDataValidator
);

export type TalentReleaseData = Infer<typeof talentReleaseDataValidator>;
export type LocationReleaseData = Infer<typeof locationReleaseDataValidator>;
export type DocumentData = Infer<typeof documentDataValidator>;

/** Which of the two a document's data is. */
export function isLocationRelease(data: DocumentData): data is LocationReleaseData {
  return data.kind === "location";
}

/** The clause this document was raised under, or the default for its kind. */
export function rightsClauseFor(data: DocumentData): string {
  const fallback = isLocationRelease(data)
    ? DEFAULT_LOCATION_RIGHTS_CLAUSE
    : DEFAULT_TALENT_RIGHTS_CLAUSE;
  return (data.rightsClause?.trim() || fallback).replace(
    "{{governingLaw}}",
    data.governingLaw
  );
}

/** Who signs: the talent, or whoever owns the location. */
export function signerSubject(data: DocumentData): {
  name: string;
  email?: string;
  phone?: string;
} {
  if (isLocationRelease(data)) {
    return { name: data.ownerName, email: data.ownerEmail, phone: data.ownerPhone };
  }
  return { name: data.talentName, email: data.talentEmail, phone: data.talentPhone };
}

/** What the document is called in a list, an email subject and a filename. */
export function releaseTitle(data: DocumentData): string {
  if (isLocationRelease(data)) {
    return `Location release: ${data.locationName || data.address || "unnamed"}`;
  }
  return `Talent release: ${data.talentName || "unnamed"}`;
}
