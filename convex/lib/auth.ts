import { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Resolves the authenticated user's active organisation.
 * Tenancy rule: every query/mutation derives the org from the Clerk token,
 * never from client-supplied arguments.
 *
 * The Clerk JWT exposes the active organisation id as `org_id` (legacy session
 * claims) or `o.id` (Clerk's newer compressed org claim shape), depending on
 * instance configuration. Both are checked.
 */
export async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity;
}

export function clerkOrgIdFromIdentity(identity: Record<string, unknown>): string | null {
  if (typeof identity.org_id === "string" && identity.org_id.length > 0) {
    return identity.org_id;
  }
  const o = identity.o;
  if (o && typeof o === "object" && "id" in o && typeof (o as { id: unknown }).id === "string") {
    return (o as { id: string }).id;
  }
  return null;
}

export async function requireOrg(ctx: QueryCtx | MutationCtx) {
  const identity = await requireIdentity(ctx);
  const clerkOrgId = clerkOrgIdFromIdentity(identity as unknown as Record<string, unknown>);
  if (!clerkOrgId) throw new Error("No active organisation");
  const org = await ctx.db
    .query("organisations")
    .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
  if (!org) throw new Error("Organisation not provisioned");
  return { identity, org };
}
