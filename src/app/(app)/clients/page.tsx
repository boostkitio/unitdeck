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

export default function ClientsPage() {
  const { organization } = useOrganization();
  const clients = useQuery(api.clients.list, organization ? {} : "skip");
  const createClient = useMutation(api.clients.create);
  const updateClient = useMutation(api.clients.update);
  const removeClient = useMutation(api.clients.remove);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"clients"> | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setName("");
    setNotes("");
    setDialogOpen(true);
  }

  function openEdit(client: Doc<"clients">) {
    setEditing(client);
    setName(client.name);
    setNotes(client.notes ?? "");
    setDialogOpen(true);
  }

  async function handleSave() {
    if (name.trim() === "") {
      toast.error("Client name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateClient({ id: editing._id, name, notes });
        toast.success("Saved.");
      } else {
        await createClient({ name, notes: notes.trim() || undefined });
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
        <Button onClick={openCreate}>Add client</Button>
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
                <TableHead>Name</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c._id} className="cursor-pointer" onClick={() => openEdit(c)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {c.notes ?? ""}
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
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add client"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="client-name">Name</Label>
              <Input
                id="client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
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
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editing ? (
              <Button variant="destructive" onClick={() => handleRemove(editing._id)}>
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
                {saving ? "Saving…" : editing ? "Save" : "Add client"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
