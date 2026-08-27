"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Your own name, as everyone else on the account sees it.
 *
 * Without one, a person is an email address wherever they are named — the
 * owner of a production reads as "matt@…" rather than as a person. Clerk
 * holds the name, so this writes to Clerk rather than to our own tables:
 * two copies of somebody's name is one copy too many.
 */
export function YourName() {
  const { isLoaded, user } = useUser();
  const [first, setFirst] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isLoaded) return <Skeleton className="h-10 w-full" />;
  if (!user) return null;

  // Null until edited, so the fields follow the account until you touch them.
  const firstName = first ?? user.firstName ?? "";
  const lastName = last ?? user.lastName ?? "";
  const changed = firstName !== (user.firstName ?? "") || lastName !== (user.lastName ?? "");

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      setFirst(null);
      setLast(null);
      toast.success("Name saved.");
    } catch (err) {
      // Clerk refuses this outright when the instance has names turned off,
      // which is a setting on the account rather than anything here.
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Could not save your name. Names may be turned off for this account.",
      );
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
