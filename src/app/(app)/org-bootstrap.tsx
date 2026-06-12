"use client";

import { useEffect } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Ensures a Convex organisation row exists for the active Clerk organisation.
 * Runs whenever the active org changes; the mutation is idempotent.
 */
export function OrgBootstrap() {
  const { organization } = useOrganization();
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.organisations.ensure);

  useEffect(() => {
    if (isAuthenticated && organization) {
      void ensure({ name: organization.name });
    }
  }, [isAuthenticated, organization, organization?.name, ensure]);

  return null;
}
