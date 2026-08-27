"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { joinName } from "../../../convex/lib/personName";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Your own name, as everyone else on the account sees it.
 *
 * Without one, a person is an email address wherever they are named — the
 * owner of a production reads as "matt@…" rather than as a person.
 *
 * This writes to UnitDeck's own database rather than to Clerk. Clerk holds a
 * first and last name, but it only accepts a write to them when Name is
 * enabled for the instance, and that is a switch on the Clerk dashboard which
 * this app has no way to reach or set. With it off — which is the default —
 * every attempt was refused, so the name simply could not be changed from
 * inside the product. It can now, and Clerk's name is read as a fallback for
 * anyone who does have one from signing up with Google.
 *
 * @param onSaved - called after a successful save, so a dialog can close.
 */
export function YourName({ onSaved }: { onSaved?: () => void } = {}) {
  const { isLoaded, user } = useUser();
  const profile = useQuery(api.memberProfiles.mine, {});
  const setName = useMutation(api.memberProfiles.setName);
  const [first, setFirst] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isLoaded || profile === undefined) return <Skeleton className="h-10 w-full" />;
  if (!user) return null;

  // What is stored: our own name if there is one, otherwise whatever Clerk
  // has, so somebody who signed up with Google starts from their real name
  // rather than from two empty boxes.
  const storedFirst = profile?.firstName ?? user.firstName ?? "";
  const storedLast = profile?.lastName ?? user.lastName ?? "";

  // Null until edited, so the fields follow the account until you touch them.
  const firstName = first ?? storedFirst;
  const lastName = last ?? storedLast;
  const changed = firstName !== storedFirst || lastName !== storedLast;

  async function save() {
    setSaving(true);
    try {
      await setName({ firstName: firstName.trim(), lastName: lastName.trim() });
      setFirst(null);
      setLast(null);
      toast.success(
        joinName({ firstName, lastName })
          ? `Saved. You are ${joinName({ firstName, lastName })} from now on.`
          : "Name cleared."
      );
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="your-first-name">First name</Label>
          <Input
            id="your-first-name"
            value={firstName}
            onChange={(e) => setFirst(e.target.value)}
            placeholder="Matt"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="your-last-name">Last name</Label>
          <Input
            id="your-last-name"
            value={lastName}
            onChange={(e) => setLast(e.target.value)}
            placeholder="Surname"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || !changed}>
          {saving ? "Saving…" : "Save name"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Shown wherever you are named — the owner of a production, who booked a
          job. Without it you appear as{" "}
          {user.primaryEmailAddress?.emailAddress ?? "your email address"}.
        </p>
      </div>
    </div>
  );
}
