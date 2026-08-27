"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** The sentinel a client picker uses for "add a new one" — not an id, and
 *  nothing is ever saved for it. */
export const NEW_CLIENT = "__new_client__";

/**
 * A new client, written from the project rather than from the Clients tab.
 *
 * A job usually arrives from somebody who is not in the book yet, and going
 * to another page to file them before the project can name them is a detour.
 * What is written here is a real client record — the same `clients.create`
 * the Clients tab calls — so it is in the database, not attached to this one
 * production.
 */
export function NewClientDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** The new client, and whether a contact was named for it. */
  onCreated: (clientId: Id<"clients">, hasContact: boolean) => void;
}) {
  const create = useMutation(api.clients.create);
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (company.trim().length === 0) {
      toast.error("A client needs a company name.");
      return;
    }
    setSaving(true);
    try {
      const hasContact = name.trim().length > 0;
      const clientId = await create({
        name: company.trim(),
        contacts: hasContact
          ? [
              {
                name: name.trim(),
                role: role.trim() || undefined,
                phone: phone.trim() || undefined,
                email: email.trim() || undefined,
              },
            ]
          : undefined,
        notes: notes.trim() || undefined,
      });
      onCreated(clientId, hasContact);
      toast.success(`${company.trim()} added to your clients.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-client-company">Company</Label>
            <Input
              id="new-client-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Who you are invoicing"
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-client-name">Contact</Label>
              <Input
                id="new-client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who booked it"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-role">Role</Label>
              <Input
                id="new-client-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Producer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-phone">Phone</Label>
              <Input
                id="new-client-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-email">Email</Label>
              <Input
                id="new-client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-client-notes">Notes</Label>
            <Textarea
              id="new-client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about them"
              rows={2}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This goes in your clients database, not just on this project. The
            company is all that is needed now — the rest can be filled in later
            from the Clients tab.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Adding…" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
