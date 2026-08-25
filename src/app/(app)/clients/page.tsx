"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { type FunctionReturnType } from "convex/server";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvImportDialog, type CsvColumnSpec } from "@/components/csv-import-dialog";
import { CsvExportButton } from "@/components/csv-export-button";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { EmailLink, PhoneLink } from "@/components/contact-link";
import { SearchInput } from "@/components/search-input";
import { matchesSearch } from "@/lib/search";

type Client = FunctionReturnType<typeof api.clients.list>[number];
type ContactDraft = { name: string; role: string; phone: string; email: string };

type ClientSortKey = "name" | "contactName" | "role" | "phone" | "email" | "notes";

/** The contact a company is filed under: the first in its list. */
function primaryContact(client: Client) {
  return client.contacts[0] ?? null;
}

function clientSortValue(client: Client, key: ClientSortKey): string | null {
  const first = primaryContact(client);
  switch (key) {
    case "name":
      return client.name;
    case "contactName":
      return first?.name ?? null;
    case "role":
      return first?.role ?? null;
    case "phone":
      return first?.phone ?? null;
    case "email":
      return first?.email ?? null;
    case "notes":
      return client.notes ?? null;
  }
}

const IMPORT_COLUMNS: CsvColumnSpec[] = [
  { key: "name", label: "Company", aliases: ["Client", "Organisation", "Organization"], required: true },
  { key: "contactName", label: "Name", aliases: ["Contact", "Contact Name", "Full Name"] },
  { key: "role", label: "Role", aliases: ["Job Title", "Title", "Position"] },
  { key: "phone", label: "Number", aliases: ["Phone", "Telephone", "Mobile", "Tel"] },
  { key: "email", label: "Email", aliases: ["E-mail", "Email Address"] },
  { key: "notes", label: "Notes", aliases: ["Comment", "Comments"] },
];

const BLANK_CONTACT: ContactDraft = { name: "", role: "", phone: "", email: "" };

export default function ClientsPage() {
  const { organization } = useOrganization();
  const clients = useQuery(api.clients.list, organization ? {} : "skip");
  const createClient = useMutation(api.clients.create);
  const updateClient = useMutation(api.clients.update);
  const removeClient = useMutation(api.clients.remove);
  const importRows = useMutation(api.clients.importRows);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  // Everybody at the company, first one first. The first is the contact the
  // company is filed under; the rest are the producer, accounts and whoever
  // signs things off, who are rarely the same person.
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [saving, setSaving] = useState(false);
  // Which companies are showing everybody rather than just the first contact.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { sort, toggle } = useTableSort<ClientSortKey>({ key: "name", dir: "asc" });
  const [search, setSearch] = useState("");

  const sortedClients = useMemo(
    () =>
      sortRows(
        (clients ?? []).filter((c) =>
          matchesSearch(search, [
            c.name,
            c.notes,
            // Every contact, not just the first: searching for the person you
            // spoke to should find the company, wherever they sit in the list.
            ...c.contacts.flatMap((p) => [p.name, p.role, p.phone, p.email]),
          ]),
        ),
        sort,
        clientSortValue,
      ),
    [clients, sort, search],
  );

  function openCreate() {
    setEditing(null);
    setName("");
    setNotes("");
    setContacts([{ ...BLANK_CONTACT }]);
    setDialogOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setName(client.name);
    setNotes(client.notes ?? "");
    setContacts(
      client.contacts.length > 0
        ? client.contacts.map((c) => ({
            name: c.name,
            role: c.role ?? "",
            phone: c.phone ?? "",
            email: c.email ?? "",
          }))
        : [{ ...BLANK_CONTACT }],
    );
    setDialogOpen(true);
  }

  async function handleSave() {
    if (name.trim() === "") {
      toast.error("Company is required.");
      return;
    }
    // A row with no name is a blank one somebody left behind.
    const cleaned = contacts
      .filter((c) => c.name.trim().length > 0)
      .map((c) => ({
        name: c.name.trim(),
        role: c.role.trim() || undefined,
        phone: c.phone.trim() || undefined,
        email: c.email.trim() || undefined,
      }));

    setSaving(true);
    try {
      if (editing) {
        await updateClient({ id: editing._id, name, contacts: cleaned, notes });
        toast.success("Saved.");
      } else {
        await createClient({
          name,
          contacts: cleaned.length > 0 ? cleaned : undefined,
          notes: notes.trim() || undefined,
        });
        toast.success("Client added.");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: Id<"clients">) {
    try {
      await removeClient({ id });
      toast.success("Client removed.");
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    }
  }

  function setContact(i: number, patch: Partial<ContactDraft>) {
    setContacts((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who you make work for.</p>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename="clients"
            headers={["Company", "Name", "Role", "Number", "Email", "Notes"]}
            rows={(clients ?? []).map((c) => {
              const first = primaryContact(c);
              return [c.name, first?.name, first?.role, first?.phone, first?.email, c.notes];
            })}
          />
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button onClick={openCreate}>Add client</Button>
        </div>
      </div>

      <div className="mt-6">
        {clients !== undefined && clients.length > 0 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search company, contact, role, number, email or notes…"
            className="mb-4 max-w-sm"
          />
        )}
        {clients === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : clients.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No clients yet.</p>
        ) : sortedClients.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No clients match “{search}”.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Company" sortKey="name" sort={sort} onSort={toggle} />
                <SortableHead label="Name" sortKey="contactName" sort={sort} onSort={toggle} />
                <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} />
                <SortableHead label="Number" sortKey="phone" sort={sort} onSort={toggle} />
                <SortableHead label="Email" sortKey="email" sort={sort} onSort={toggle} />
                <SortableHead label="Notes" sortKey="notes" sort={sort} onSort={toggle} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedClients.flatMap((c) => {
                const first = primaryContact(c);
                const others = c.contacts.slice(1);
                const open = expanded[c._id] ?? false;

                // Clicking the company shows everybody there rather than
                // opening the editor: reading who you deal with is the common
                // errand, and editing them is one more click from Edit.
                const rows = [
                  <TableRow
                    key={c._id}
                    className={others.length > 0 ? "cursor-pointer" : undefined}
                    onClick={
                      others.length > 0
                        ? () => setExpanded((rows) => ({ ...rows, [c._id]: !open }))
                        : undefined
                    }
                  >
                    <TableCell className="font-medium">
                      {others.length > 0 && (
                        <span
                          aria-hidden
                          className="mr-1.5 inline-block w-2 text-xs text-muted-foreground"
                        >
                          {open ? "▾" : "▸"}
                        </span>
                      )}
                      {c.name}
                      {others.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {c.contacts.length} contacts
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{first?.name ?? "·"}</TableCell>
                    <TableCell className="text-muted-foreground">{first?.role ?? "·"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <PhoneLink phone={first?.phone} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <EmailLink email={first?.email} />
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{c.notes ?? ""}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(c);
                          }}
                        >
                          Edit
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>,
                ];

                if (open) {
                  for (const [i, contact] of others.entries()) {
                    rows.push(
                      <TableRow key={`${c._id}-${i}`} className="bg-muted/40">
                        <TableCell />
                        <TableCell className="text-muted-foreground">{contact.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.role ?? "·"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <PhoneLink phone={contact.phone} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <EmailLink email={contact.email} />
                        </TableCell>
                        <TableCell />
                      </TableRow>,
                    );
                  }
                }

                return rows;
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {importOpen && (
        <CsvImportDialog
          title="Import clients from CSV"
          description="Every row becomes a client. A row whose company already exists updates that client rather than creating a duplicate, so you can safely re-import a corrected file."
          columns={IMPORT_COLUMNS}
          exampleHeader="Company,Name,Role,Number,Email,Notes"
          onImportBatch={(rows) =>
            importRows({
              rows: rows.map((row) => ({
                name: row.name ?? "",
                contactName: row.contactName,
                role: row.role,
                phone: row.phone,
                email: row.email,
                notes: row.notes,
              })),
            })
          }
          onClose={() => setImportOpen(false)}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit client" : "Add client"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="client-company">Company</Label>
              <Input
                id="client-company"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Films"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Contacts</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setContacts((rows) => [...rows, { ...BLANK_CONTACT }])}
                >
                  Add contact
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The first is who the company is filed under.
              </p>
              <ul className="space-y-2">
                {contacts.map((contact, i) => (
                  <li key={i} className="space-y-2 rounded-md border border-border p-2">
                    <div className="flex gap-2">
                      <Input
                        value={contact.name}
                        onChange={(e) => setContact(i, { name: e.target.value })}
                        placeholder="Name"
                        aria-label="Contact name"
                      />
                      <Input
                        value={contact.role}
                        onChange={(e) => setContact(i, { role: e.target.value })}
                        placeholder="Role"
                        aria-label="Contact role"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setContacts((rows) => rows.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={contact.phone}
                        onChange={(e) => setContact(i, { phone: e.target.value })}
                        placeholder="Number"
                        aria-label="Contact number"
                      />
                      <Input
                        value={contact.email}
                        onChange={(e) => setContact(i, { email: e.target.value })}
                        placeholder="Email"
                        aria-label="Contact email"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-notes">Notes</Label>
              <Textarea
                id="client-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            {editing ? (
              <Button variant="ghost" onClick={() => void handleRemove(editing._id)}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
