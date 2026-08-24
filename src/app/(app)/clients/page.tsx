"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvImportDialog, type CsvColumnSpec } from "@/components/csv-import-dialog";

const IMPORT_COLUMNS: CsvColumnSpec[] = [
  { key: "name", label: "Company", aliases: ["Client", "Organisation", "Organization"], required: true },
  { key: "contactName", label: "Name", aliases: ["Contact", "Contact Name", "Full Name"] },
  { key: "phone", label: "Number", aliases: ["Phone", "Telephone", "Mobile", "Tel"] },
  { key: "email", label: "Email", aliases: ["E-mail", "Email Address"] },
  { key: "notes", label: "Notes", aliases: ["Comment", "Comments"] },
];

export default function ClientsPage() {
  const { organization } = useOrganization();
  const clients = useQuery(api.clients.list, organization ? {} : "skip");
  const createClient = useMutation(api.clients.create);
  const updateClient = useMutation(api.clients.update);
  const removeClient = useMutation(api.clients.remove);
  const importRows = useMutation(api.clients.importRows);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"clients"> | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setContactName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setDialogOpen(true);
  }

  function openEdit(client: Doc<"clients">) {
    setEditing(client);
    setName(client.name);
    setContactName(client.contactName ?? "");
    setPhone(client.phone ?? "");
    setEmail(client.email ?? "");
    setNotes(client.notes ?? "");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (name.trim() === "") {
      toast.error("Company is required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateClient({
          id: editing._id,
          name,
          contactName: contactName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          notes,
        });
        toast.success("Saved.");
      } else {
        await createClient({
          name,
          contactName: contactName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who you make work for.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button onClick={openCreate}>Add client</Button>
        </div>
      </div>

      <div className="mt-6">
        {clients === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : clients.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No clients yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c._id} className="cursor-pointer" onClick={() => openEdit(c)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.contactName ?? "·"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.phone ? (
                      <a
                        href={`tel:${c.phone}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.phone}
                      </a>
                    ) : (
                      "·"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.email}
                      </a>
                    ) : (
                      "·"
                    )}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {c.notes ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {importOpen && (
        <CsvImportDialog
          title="Import clients from CSV"
          description="Every row becomes a client. A row whose company already exists updates that client rather than creating a duplicate, so you can safely re-import a corrected file."
          columns={IMPORT_COLUMNS}
          exampleHeader="Company,Name,Number,Email,Notes"
          onImportBatch={(rows) =>
            importRows({
              rows: rows.map((row) => ({
                name: row.name ?? "",
                contactName: row.contactName,
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
        <DialogContent>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="client-contact">Name</Label>
                <Input
                  id="client-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Contact at the company"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-phone">Number</Label>
                <Input
                  id="client-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07700 900000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-email">Email</Label>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
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
