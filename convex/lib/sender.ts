import type { MutationCtx, QueryCtx } from "../_generated/server";
import { joinName } from "./personName";

export type Sender = { senderName?: string; senderEmail?: string };

/**
 * Who is sending, for the From line and Reply-To.
 *
 * Everything UnitDeck posts goes out in the name of whoever pressed send: a
 * call sheet is from the producer, not from a piece of software, and a crew
 * member who hits reply has to reach a person. The address on the envelope
 * stays ours because mail is only signed for our domain — see `fromLine` —
 * so this is the name and the Reply-To.
 *
 * The name they set in UnitDeck comes first, since Clerk's is blank unless
 * Name is enabled for the instance; then whatever the login carries.
 */
export async function senderOf(ctx: QueryCtx | MutationCtx): Promise<Sender> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return {};
  const org = await ctx.db
    .query("organisations")
    .withIndex("by_clerk_org", (q) =>
      q.eq("clerkOrgId", String((identity as unknown as Record<string, unknown>).org_id ?? ""))
    )
    .unique();
  const profile = org
    ? await ctx.db
        .query("memberProfiles")
        .withIndex("by_org_user", (q) => q.eq("orgId", org._id).eq("userId", identity.subject))
        .unique()
    : null;
  return {
    senderName:
      joinName(profile) ||
      (typeof identity.name === "string" ? identity.name.trim() : "") ||
      undefined,
    senderEmail: typeof identity.email === "string" ? identity.email : undefined,
  };
}
