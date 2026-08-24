"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { type ProjectCrewMember } from "../../../convex/projectCrew";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export function CrewSection({ projectId }: { projectId: Id<"projects"> }) {
  const crew = useQuery(api.projectCrew.listForProject, { projectId });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectCrewMember | null>(null);
  const removeCrew = useMutation(api.projectCrew.remove);

  async function handleRemove(member: ProjectCrewMember) {
    try {
      await removeCrew({ id: member._id });
      toast.success(`${member.name} removed from this project.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove them.");
    }
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Crew</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setAdding(true)}>
            Add crew
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {crew === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : crew.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nobody on this production yet. Add crew from your{" "}
            <Link href="/people" className="underline underline-offset-2 text-foreground">
              people
            </Link>{" "}
            list.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {crew.map((member) => (
                <TableRow key={member._id}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.role}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.email ? (
                      <a href={`mailto:${member.email}`} className="hover:underline">
                        {member.email}
                      </a>
                    ) : (
                      "·"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.phone ? (
                      <a href={`tel:${member.phone}`} className="hover:underline">
                        {member.phone}
                      </a>
                    ) : (
                      "·"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(member)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleRemove(member)}>
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {crew !== undefined && crew.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Contact details come from your{" "}
            <Link href="/people" className="underline underline-offset-2">
              people
            </Link>{" "}
            list — edit them there to update every production at once.
          </p>
        )}
      </CardContent>

      {adding && (
        <AddCrewDialog
          projectId={projectId}
          existing={crew ?? []}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <EditCrewDialog member={editing} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}

function AddCrewDialog({
  projectId,
  existing,
  onClose,
}: {
  projectId: Id<"projects">;
  existing: ProjectCrewMember[];
  onClose: () => void;
}) {
  const people = useQuery(api.people.list, {});
  const addCrew = useMutation(api.projectCrew.add);
  const [personId, setPersonId] = useState<string>("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);

  // Someone already booked cannot be booked twice.
  const available = useMemo(() => {
    const taken = new Set(existing.map((m) => m.personId as string));
    return (people ?? []).filter((p) => !taken.has(p._id));
  }, [people, existing]);

  const selected = available.find((p) => p._id === personId) ?? null;

  async function handleAdd() {
    if (!personId) {
      toast.error("Pick someone to add.");
      return;
    }
    setSaving(true);
    try {
      await addCrew({
        projectId,
        personId: personId as Id<"people">,
        role: role.trim() || undefined,
      });
      toast.success("Crew member added.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add crew to this project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {people === undefined ? (
            <Skeleton className="h-10 w-full" />
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {people.length === 0
                ? "Your people list is empty."
                : "Everyone in your people list is already on this project."}{" "}
              <Link href="/people" className="underline underline-offset-2 text-foreground">
                Manage people
              </Link>
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Person</Label>
                <Select
                  value={personId || "none"}
                  onValueChange={(value) => setPersonId(value === "none" || value === null ? "" : value)}
                >
                  <SelectTrigger>
                    {/* Explicit label: Base UI shows the raw value when items mount late */}
                    <SelectValue>{selected ? selected.name : "Choose someone"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose someone</SelectItem>
                    {available.map((person) => (
                      <SelectItem key={person._id} value={person._id}>
                        {person.name} · {person.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crew-role">Role on this project (optional)</Label>
                <Input
                  id="crew-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={selected ? selected.role : "Leave blank to use their usual role"}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={saving || available.length === 0 || !personId}>
            {saving ? "Adding…" : "Add to project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCrewDialog({
  member,
  onClose,
}: {
  member: ProjectCrewMember;
  onClose: () => void;
}) {
  const updateCrew = useMutation(api.projectCrew.update);
  const [role, setRole] = useState(member.role);
  const [notes, setNotes] = useState(member.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateCrew({
        id: member._id,
        // Blank clears the override and falls back to their usual role.
        role: role.trim() || null,
        notes: notes.trim() || null,
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
          <DialogTitle>{member.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-crew-role">Role on this project</Label>
            <Input
              id="edit-crew-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Leave blank to use their usual role"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-crew-notes">Notes (optional)</Label>
            <Textarea
              id="edit-crew-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Name, email and phone live on their{" "}
            <Link href="/people" className="underline underline-offset-2">
              people
            </Link>{" "}
            record.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
