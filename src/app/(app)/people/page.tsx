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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type PersonForm = {
  name: string;
  role: string;
  email: string;
  phone: string;
  dayRate: string;
  dietary: string;
};

const EMPTY_FORM: PersonForm = { name: "", role: "", email: "", phone: "", dayRate: "", dietary: "" };

export default function PeoplePage() {
  const { organization } = useOrganization();
  const people = useQuery(api.people.list, organization ? {} : "skip");
  const createPerson = useMutation(api.people.create);
  const updatePerson = useMutation(api.people.update);
  const removePerson = useMutation(api.people.remove);

  const [dialogOpen, setDialogOpen] = useState(false);
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
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Crew, freelancers and contacts. Your company memory.
          </p>
        </div>
        <Button onClick={openCreate}>Add person</Button>
      </div>

      <div className="mt-6">
        {people === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : people.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutral-500">
            No people yet. Add your regular crew first.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Day rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => (
                <TableRow
                  key={p._id}
                  className="cursor-pointer"
                  onClick={() => openEdit(p)}
                >
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-neutral-500">{p.role}</TableCell>
                  <TableCell className="text-neutral-500">{p.email ?? ""}</TableCell>
                  <TableCell className="text-neutral-500">{p.phone ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.dayRate !== undefined ? `£${p.dayRate}` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

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
