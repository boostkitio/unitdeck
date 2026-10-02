"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { type ProjectClientContact } from "../../../convex/projectClients";
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
import { NoteCell } from "@/components/projects/note-cell";

/** A contact on this production, carrying its booking and its place in the
 *  client's book — the booking is what a removal deletes. */
type IndexedContact = ProjectClientContact;

type ContactSortKey = "name" | "role" | "status" | "email" | "phone" | "notes";

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
    case "notes":
      return contact.notes;
    case "status":
      // On site first when sorted ascending: they are the ones a call sheet
      // and a catering order have to account for.
      return contact.attendance === "on_site" ? 0 : 1;
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
  projectId,
  clientId,
  clientName,
}: {
  projectId: Id<"projects">;
  clientId: Id<"clients"> | null;
  clientName: string | null;
}) {
  const client = useQuery(api.clients.get, clientId ? { id: clientId } : "skip");
  const onShoot = useQuery(api.projectClients.listForProject, { projectId });
  const addToShoot = useMutation(api.projectClients.add);
  const removeFromShoot = useMutation(api.projectClients.remove);
  const setContactNotes = useMutation(api.projectClients.setNotes);
  const setAttendance = useMutation(api.projectClients.setAttendance);
  const people = useQuery(api.people.list, { kind: "crew" });
  const createPerson = useMutation(api.people.create);
  const [savingToPeople, setSavingToPeople] = useState<number | null>(null);

  /**
   * Whether somebody is already in People, by email or else by name. A client
   * contact lives in the client's book, not in People, until somebody asks.
   */
  function inPeople(contact: IndexedContact): boolean {
    const email = contact.email?.trim().toLowerCase();
    const name = contact.name.trim().toLowerCase();
    return (people ?? []).some((person) =>
      email ? person.email?.trim().toLowerCase() === email : person.name.trim().toLowerCase() === name,
    );
  }

  async function handleAddToPeople(contact: IndexedContact) {
    setSavingToPeople(contact.index);
    try {
      await createPerson({
        name: contact.name,
        role: contact.role?.trim() || `Client, ${client?.name ?? "client"}`,
        email: contact.email?.trim() || undefined,
        phone: contact.phone?.trim() || undefined,
      });
      toast.success(`${contact.name} added to your People list.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setSavingToPeople(null);
    }
  }
  const { sort, toggle } = useTableSort<ContactSortKey>({ key: "name", dir: "asc" });

  const [editing, setEditing] = useState<IndexedContact | null>(null);
  const [adding, setAdding] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  const contacts = useMemo(
    () => sortRows(onShoot ?? [], sort, contactSortValue),
    [onShoot, sort],
  );

  // Everybody at the company who is not on this job yet, to pick from.
  const available = useMemo(() => {
    const on = new Set((onShoot ?? []).map((c) => c.index));
    return (client?.contacts ?? [])
      .map((c, index) => ({
        ...c,
        index,
        bookingId: null,
        notes: null,
        attendance: "off_site" as const,
      }))
      .filter((c) => !on.has(c.index));
  }, [client, onShoot]);

  /**
   * Takes somebody off this production. It deletes the booking and nothing
   * else — they stay in the client's book, where they still work.
   */
  async function handleRemove(contact: IndexedContact) {
    try {
      await removeFromShoot({ projectId, index: contact.index });
      toast.success(`${contact.name} taken off this production.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove them.");
    }
  }

  async function handleAdd(index: number) {
    try {
      await addToShoot({ projectId, index });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them.");
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
            Nobody from {client.name} on this production yet. Add whoever is involved with
            the button above.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium">{client.name}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                  <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} />
                  {/* The same column crew and talent carry their booking
                      status in, so the three tables read as one. */}
                  <SortableHead
                    label="Status"
                    sortKey="status"
                    sort={sort}
                    onSort={toggle}
                    className="w-32"
                  />
                  <SortableHead label="Email" sortKey="email" sort={sort} onSort={toggle} />
                  <SortableHead label="Phone" sortKey="phone" sort={sort} onSort={toggle} />
                  <SortableHead label="Notes" sortKey="notes" sort={sort} onSort={toggle} />
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
                    {/* Where the crew and talent tables carry the booking
                        status. A client is not booked, but whether they are
                        coming changes the call sheet and the catering, so it
                        is the same click in the same column. */}
                    <TableCell className="w-32 align-middle">
                      <button
                        type="button"
                        onClick={() =>
                          void setAttendance({
                            projectId,
                            index: contact.index,
                            attendance: contact.attendance === "on_site" ? "off_site" : "on_site",
                          }).catch((err: unknown) =>
                            toast.error(
                              err instanceof Error ? err.message : "Could not change it."
                            )
                          )
                        }
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                          contact.attendance === "on_site"
                            ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground hover:bg-muted/70"
                        )}
                      >
                        {contact.attendance === "on_site" ? "On site" : "Off site"}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <EmailLink email={contact.email} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <PhoneLink phone={contact.phone} />
                    </TableCell>
                    <TableCell className="min-w-40">
                      <NoteCell
                        value={contact.notes}
                        onSave={async (notes) => {
                          await setContactNotes({ projectId, index: contact.index, notes });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {people !== undefined && !inPeople(contact) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={savingToPeople !== null}
                            title={`Save ${contact.name} to your People list as well as ${client.name}'s contacts`}
                            onClick={() => void handleAddToPeople(contact)}
                          >
                            {savingToPeople === contact.index ? "Adding…" : "Add to People"}
                          </Button>
                        )}
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
              Remove takes somebody off this production only — they stay in{" "}
              {client.name}&rsquo;s contacts. They are not added to People unless you choose Add
              to People. Edit changes them everywhere; the whole book is on your{" "}
              <Link href="/clients" className="underline underline-offset-2">
                clients
              </Link>{" "}
              list.
            </p>
          </>
        )}
      </CardContent>

      {clientId && adding && (
        <AddContactDialog
          clientId={clientId}
          clientName={client?.name ?? clientName ?? "this client"}
          available={available}
          onPick={(index) => void handleAdd(index)}
          onClose={() => setAdding(false)}
        />
      )}
      {clientId && editing && (
        <ContactDialog
          // Remounted per contact so the fields hold that person, not
          // whoever the dialog was last opened on.
          key={`edit-${editing.index}`}
          clientId={clientId}
          contact={editing}
          onClose={() => setEditing(null)}
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
  onAdded,
  onClose,
}: {
  clientId: Id<"clients">;
  /** Null to add somebody new. */
  contact: IndexedContact | null;
  /** Called with the new contact's position when one is written here. */
  onAdded?: (index: number) => void;
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
      const index = await save({
        id: clientId,
        index: contact?.index,
        name: name.trim(),
        role: role.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      // Somebody written here is wanted on this production too, not merely
      // filed in the client's book.
      if (!contact && onAdded && typeof index === "number") onAdded(index);
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

/**
 * Who at the client is on this shoot.
 *
 * The company's book is the list to pick from; a client of any size has an
 * accounts contact and a legal contact who will never be on set, and putting
 * them on a call sheet helps nobody. Somebody genuinely new can be written
 * here too, which adds them to the book and to the shoot at once.
 */
function AddContactDialog({
  clientId,
  clientName,
  available,
  onPick,
  onClose,
}: {
  clientId: Id<"clients">;
  clientName: string;
  available: IndexedContact[];
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const [writing, setWriting] = useState(available.length === 0);

  if (writing) {
    return <ContactDialog clientId={clientId} contact={null} onAdded={onPick} onClose={onClose} />;
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Who at {clientName} is on this production?</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-md border border-border">
          {available.map((contact) => (
            <li key={contact.index} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{contact.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") ||
                    "No details yet"}
                </span>
              </span>
              <Button
                size="sm"
                onClick={() => {
                  onPick(contact.index);
                  onClose();
                }}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-between">
          <Button variant="secondary" onClick={() => setWriting(true)}>
            Somebody new
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
