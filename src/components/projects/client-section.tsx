"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { type ClientContact } from "../../../convex/clients";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { EmailLink, PhoneLink } from "@/components/contact-link";

/** A contact with the position it holds in the client's list, which is what
 *  edits and removals are addressed by. */
type IndexedContact = ClientContact & { index: number };

type ContactSortKey = "name" | "role" | "email" | "phone";

function contactSortValue(contact: IndexedContact, key: ContactSortKey): string | number | null {
  switch (key) {
    case "name":
      return contact.name;
    case "role":
      return contact.role ?? null;
    case "email":
      return contact.email ?? null;
    case "phone":
      return contact.phone ?? null;
  }
}

const MAILTO_SAFE_LENGTH = 1800;

/**
 * The client's people, laid out exactly like crew and talent.
 *
 * The three boxes are read together — they are the three lists a call sheet
 * needs — so they share a table, the same columns in the same order, the same
 * widths and the same buttons. A client contact has no booking status, so that
 * column sits empty rather than shifting everything after it out of line.
 */
export function ProjectClientSection({
  clientId,
  clientName,
}: {
  clientId: Id<"clients"> | null;
  clientName: string | null;
}) {
  const client = useQuery(api.clients.get, clientId ? { id: clientId } : "skip");
  const removeContact = useMutation(api.clients.removeContact);
  const { sort, toggle } = useTableSort<ContactSortKey>({ key: "name", dir: "asc" });

  const [editing, setEditing] = useState<IndexedContact | null>(null);
  const [adding, setAdding] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  const contacts = useMemo(() => {
    // Indexed before sorting: the position in the stored list is what a save
    // writes back to, and sorting the table must not move it.
    const indexed = (client?.contacts ?? []).map((c, index) => ({ ...c, index }));
    return sortRows(indexed, sort, contactSortValue);
  }, [client, sort]);

  async function handleRemove(contact: IndexedContact) {
    if (!clientId) return;
    try {
      await removeContact({ id: clientId, index: contact.index });
      toast.success(`${contact.name} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove them.");
    }
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Client</CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForwarding(true)}
              disabled={contacts.length === 0}
            >
              Forward
            </Button>
            {clientId ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                Add client
              </Button>
            ) : (
              <Button size="sm" render={<Link href="/clients" />}>
                Choose a client
              </Button>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!clientId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No client on this production. Choose one under Details above.
          </p>
        ) : client === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : client === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {clientName ?? "That client"} is no longer in your clients list.
          </p>
        ) : contacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No contacts for {client.name} yet. Add the first with the button above.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium">{client.name}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                  <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} />
                  {/* Kept so the columns line up with crew and talent. */}
                  <TableHead className="w-32" />
                  <SortableHead label="Email" sortKey="email" sort={sort} onSort={toggle} />
                  <SortableHead label="Phone" sortKey="phone" sort={sort} onSort={toggle} />
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.index}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.role ?? "·"}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-muted-foreground">
                      <EmailLink email={contact.email} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <PhoneLink phone={contact.phone} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(contact)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleRemove(contact)}
                        >
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              Edits here change {client.name} everywhere — see the whole book on your{" "}
              <Link href="/clients" className="underline underline-offset-2">
                clients
              </Link>{" "}
              list.
            </p>
          </>
        )}
      </CardContent>

      {clientId && (adding || editing) && (
        <ContactDialog
          // Remounted per contact so the fields hold that person, not
          // whoever the dialog was last opened on.
          key={editing ? `edit-${editing.index}` : "add"}
          clientId={clientId}
          contact={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {forwarding && client && (
        <ForwardContactsDialog
          clientName={client.name}
          contacts={contacts}
          onClose={() => setForwarding(false)}
        />
      )}
    </Card>
  );
}

function ContactDialog({
  clientId,
  contact,
  onClose,
}: {
  clientId: Id<"clients">;
  /** Null to add somebody new. */
  contact: IndexedContact | null;
  onClose: () => void;
}) {
  const save = useMutation(api.clients.saveContact);
  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (name.trim().length === 0) {
      toast.error("A contact needs a name.");
      return;
    }
    setSaving(true);
    try {
      await save({
        id: clientId,
        index: contact?.index,
        name: name.trim(),
        role: role.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      toast.success("Saved.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Name</Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who you deal with"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-role">Role</Label>
              <Input
                id="contact-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Producer, marketing, accounts…"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Number</Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07700 900000"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function contactsEmailBody(clientName: string, contacts: IndexedContact[]): string {
  const lines = [`Contacts at ${clientName}`, ""];
  for (const c of contacts) {
    const detail = [c.email, c.phone].filter(Boolean).join(" · ");
    lines.push(`- ${c.name}${c.role ? ` — ${c.role}` : ""}${detail ? `\n  ${detail}` : ""}`);
  }
  return lines.join("\n");
}

function ForwardContactsDialog({
  clientName,
  contacts,
  onClose,
}: {
  clientName: string;
  contacts: IndexedContact[];
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);
  const subject = `Client contacts — ${clientName}`;
  const [body, setBody] = useState<string | null>(null);
  const composed = body ?? contactsEmailBody(clientName, contacts);

  const mailtoHref = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(composed)}`;
  const tooLongForMailto = mailtoHref.length > MAILTO_SAFE_LENGTH;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${composed}`);
      setCopied(true);
      toast.success("Copied. Paste it into your email client.");
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Forward the client contacts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="forward-client-to">To (optional)</Label>
            <Input
              id="forward-client-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="producer@example.com"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forward-client-subject">Subject</Label>
            <Input
              id="forward-client-subject"
              value={subject}
              readOnly
              className="text-muted-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forward-client-body">Message</Label>
            <Textarea
              id="forward-client-body"
              value={composed}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Edit freely before sending — {contacts.length} contact
              {contacts.length === 1 ? "" : "s"} included.
            </p>
          </div>
          {tooLongForMailto && (
            <p className="text-xs text-muted-foreground">
              This list is long enough that some email clients would truncate it. Copy it
              instead of opening your client.
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void copyToClipboard()}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button render={<a href={mailtoHref} />}>Open in email client</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
