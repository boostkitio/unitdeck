"use client";

import { useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { UserIcon } from "lucide-react";
import { YourName } from "@/components/settings/your-name";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The account button, with somewhere to put your name in it.
 *
 * Two routes to the same fields, because the first one was not findable.
 * "Your name" is an item on the menu itself, next to Manage account — one
 * click from the picture, which is where somebody goes to update their
 * profile. It opens our own dialog rather than a page inside Clerk's modal:
 * the modal's custom pages sit in a left-hand nav that collapses to a back
 * arrow on a narrow window, and "Update profile" in there is Clerk's own
 * section, which shows only the picture unless Name is enabled for the
 * instance. The page inside the modal is kept as well, for anyone who has
 * already gone looking there.
 *
 * The defaults are listed explicitly so Your name comes first; Clerk appends
 * them in its own order otherwise.
 *
 * Used in both the sidebar and the top bar so the menu is the same whichever
 * one you click.
 */
export function AccountButton() {
  const [editingName, setEditingName] = useState(false);

  return (
    <>
      <UserButton>
        <UserButton.MenuItems>
          <UserButton.Action
            label="Your name"
            labelIcon={<UserIcon className="size-4" />}
            onClick={() => setEditingName(true)}
          />
          <UserButton.Action label="manageAccount" />
          <UserButton.Action label="signOut" />
        </UserButton.MenuItems>

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

      <Dialog open={editingName} onOpenChange={setEditingName}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your name</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <YourName onSaved={() => setEditingName(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
