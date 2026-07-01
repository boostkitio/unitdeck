import { Infer, v } from "convex/values";

export const talentReleaseDataValidator = v.object({
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
});

export type TalentReleaseData = Infer<typeof talentReleaseDataValidator>;
