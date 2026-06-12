"use client";

import { ReactNode, useEffect } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Ensures a Convex organisation row exists for the active Clerk organisation,
 * and gates the app's children until it does. Without the gate, org-scoped
 * queries fire before `ensure` lands on first sign-in and crash the page
 * with "Organisation not provisioned".
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const { organization } = useOrganization();
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.organisations.ensure);
  const org = useQuery(api.organisations.current, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (isAuthenticated && organization) {
      void ensure({ name: organization.name });
    }
  }, [isAuthenticated, organization, organization?.name, ensure]);

  // No active Clerk org (or still resolving): pages handle this themselves
  if (!organization) return <>{children}</>;

  // Clerk org active but Convex row not provisioned yet: hold the queries back
  if (isAuthenticated && !org) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}
