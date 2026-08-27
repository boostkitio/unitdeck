"use client";

import { UserButton } from "@clerk/nextjs";
import { UserIcon } from "lucide-react";
import { YourName } from "@/components/settings/your-name";

/**
 * The account button, with somewhere to put your name in it.
 *
 * Clerk's own Account page shows First and Last name only when names are
 * enabled for the instance, which is a switch on the Clerk dashboard rather
 * than anything this app can set. Adding our own page to the same modal puts
 * the fields where somebody looking to update their profile actually goes —
 * next to the picture — without depending on that switch.
 *
 * Used in both the sidebar and the top bar so the modal is the same whichever
 * one you click.
 */
export function AccountButton() {
  return (
    <UserButton>
      <UserButton.UserProfilePage
        label="Your name"
        url="your-name"
        labelIcon={<UserIcon className="size-4" />}
      >
        <div className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Your name</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              How you are named to everyone else on the account.
            </p>
          </div>
          <YourName />
        </div>
      </UserButton.UserProfilePage>
    </UserButton>
  );
}
