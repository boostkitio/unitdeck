"use client";

import { useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvImportDialog, type CsvColumnSpec } from "@/components/csv-import-dialog";
import { Textarea } from "@/components/ui/textarea";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { EmailLink, PhoneLink } from "@/components/contact-link";

type PersonForm = {
  name: string;
  role: string;
  email: string;
  phone: string;
  dayRate: string;
  dietary: string;
  notes: string;
};

const EMPTY_FORM: PersonForm = {
  name: "",
  role: "",
  email: "",
  phone: "",
  dayRate: "",
  dietary: "",
  notes: "",
};

type PersonSortKey = "name" | "role" | "email" | "phone" | "notes" | "dayRate";

function personSortValue(person: Doc<"people">, key: PersonSortKey): string | number | null {
  switch (key) {
    case "name":
      return person.name;
    case "role":
      return person.role;
    case "email":
      return person.email ?? null;
    case "phone":
      return person.phone ?? null;
    case "notes":
      return person.notes ?? null;
    case "dayRate":
      return person.dayRate ?? null;
  }
}

const IMPORT_COLUMNS: CsvColumnSpec[] = [
  { key: "name", label: "Name", aliases: ["Full Name", "Contact"], required: true },
  { key: "role", label: "Role", aliases: ["Job", "Job Role", "Position", "Department"] },
  { key: "email", label: "Email", aliases: ["E-mail", "Email Address"] },
  { key: "phone", label: "Phone", aliases: ["Number", "Telephone", "Mobile", "Tel"] },
  { key: "notes", label: "Notes", aliases: ["Comment", "Comments"] },
];

export default function PeoplePage() {
  const { organization } = useOrganization();
  const people = useQuery(api.people.list, organization ? {} : "skip");
  const createPerson = useMutation(api.people.create);
  const updatePerson = useMutation(api.people.update);
  const removePerson = useMutation(api.people.remove);

  const importRows = useMutation(api.people.importRows);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { sort, toggle } = useTableSort<PersonSortKey>({ key: "name", dir: "asc" });

  const sortedPeople = useMemo(
    () => sortRows(people ?? [], sort, personSortValue),
    [people, sort],
  );
  const [editing, setEditing] = useState<Doc<"people"> | null>(null);
  const [form, setForm] = useState<PersonForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(person: Doc<"people">) {
    setEditing(person);
    setForm({
      name: person.name,
      role: person.role,
      email: person.email ?? "",
      phone: person.phone ?? "",
      dayRate: person.dayRate?.toString() ?? "",
      dietary: person.dietary ?? "",
      notes: person.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (form.name.trim() === "" || form.role.trim() === "") {
      toast.error("Name and role are required.");
      return;
    }
    const dayRate = form.dayRate.trim() === "" ? undefined : Number(form.dayRate);
    if (dayRate !== undefined && Number.isNaN(dayRate)) {
      toast.error("Day rate must be a number.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updatePerson({
          id: editing._id,
          name: form.name,
          role: form.role,
          email: form.email,
          phone: form.phone,
          dayRate: dayRate ?? null,
          dietary: form.dietary,
          notes: form.notes,
        });
        toast.success("Saved.");
      } else {
        await createPerson({
          name: form.name,
          role: form.role,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          dayRate,
          dietary: form.dietary.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
        toast.success("Person added.");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: Id<"people">) {
    try {
      await removePerson({ id });
      toast.success("Person removed.");
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crew, freelancers and contacts. Your company memory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button onClick={openCreate}>Add person</Button>
        </div>
      </div>

      <div className="mt-6">
        {people === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : people.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No people yet. Add your regular crew first.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                    <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} />
                    <SortableHead label="Email" sortKey="email" sort={sort} onSort={toggle} />
                    <SortableHead label="Phone" sortKey="phone" sort={sort} onSort={toggle} />
                    <SortableHead label="Notes" sortKey="notes" sort={sort} onSort={toggle} />
                    <SortableHead
                      label="Day rate"
                      sortKey="dayRate"
                      sort={sort}
                      onSort={toggle}
                      className="text-right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPeople.map((p) => (
                    <TableRow
                      key={p._id}
                      className="cursor-pointer"
                      onClick={() => openEdit(p)}
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.role}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <EmailLink email={p.email} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <PhoneLink phone={p.phone} />
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {p.notes ?? ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.dayRate !== undefined ? `£${p.dayRate}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Mobile card list */}
            <ul className="space-y-2 md:hidden">
              {sortedPeople.map((p) => (
                <li
                  key={p._id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer rounded-lg border border-border bg-card px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openEdit(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEdit(p);
                    }
                  }}
                >
                  <p className="font-medium text-foreground">{p.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.role}</p>
                  {p.email && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Email</span>{" "}
                      {p.email}
                    </p>
                  )}
                  {p.phone && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Phone</span>{" "}
                      {p.phone}
                    </p>
                  )}
                  {p.dayRate !== undefined && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Day rate</span>{" "}
                      £{p.dayRate}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {importOpen && (
        <CsvImportDialog
          title="Import people from CSV"
          description="Every row becomes a contact. A row whose name already exists updates that person rather than creating a duplicate, so you can safely re-import a corrected file. A blank role defaults to \u201cCrew\u201d."
          columns={IMPORT_COLUMNS}
          exampleHeader="Name,Role,Email,Phone,Notes"
          onImportBatch={(rows) =>
            importRows({
              rows: rows.map((row) => ({
                name: row.name ?? "",
                role: row.role,
                email: row.email,
                phone: row.phone,
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
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add person"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="person-name">Name</Label>
              <Input
                id="person-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-role">Role</Label>
              <Input
                id="person-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="DP, Sound recordist…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-email">Email</Label>
              <Input
                id="person-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-phone">Phone</Label>
              <Input
                id="person-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-rate">Day rate (£)</Label>
              <Input
                id="person-rate"
                inputMode="numeric"
                value={form.dayRate}
                onChange={(e) => setForm({ ...form, dayRate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-dietary">Dietary notes</Label>
              <Input
                id="person-dietary"
                value={form.dietary}
                onChange={(e) => setForm({ ...form, dietary: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="person-notes">Notes</Label>
            <Textarea
              id="person-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editing ? (
              <Button
                variant="destructive"
                onClick={() => handleRemove(editing._id)}
                type="button"
              >
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
                {saving ? "Saving…" : editing ? "Save" : "Add person"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
