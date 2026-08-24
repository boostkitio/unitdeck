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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatShootDateRange } from "@/lib/format-date";

export function CrewSection({
  projectId,
  projectName,
}: {
  projectId: Id<"projects">;
  projectName: string;
}) {
  const crew = useQuery(api.projectCrew.listForProject, { projectId });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectCrewMember | null>(null);
  const [forwarding, setForwarding] = useState(false);
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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForwarding(true)}
              disabled={crew === undefined || crew.length === 0}
            >
              Forward
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              Add crew
            </Button>
          </div>
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
      {forwarding && crew !== undefined && (
        <ForwardCrewDialog
          projectId={projectId}
          projectName={projectName}
          crew={crew}
          onClose={() => setForwarding(false)}
        />
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
  const createPerson = useMutation(api.people.create);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // New-person fields, so someone can be added without leaving the dialog.
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Someone already booked cannot be booked twice.
  const available = useMemo(() => {
    const taken = new Set(existing.map((m) => m.personId as string));
    return (people ?? []).filter((p) => !taken.has(p._id));
  }, [people, existing]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length === 0) return available;
    return available.filter((p) =>
      [p.name, p.role, p.email ?? "", p.phone ?? ""].some((field) =>
        field.toLowerCase().includes(term),
      ),
    );
  }, [available, search]);

  async function choose(personId: Id<"people">) {
    setSaving(true);
    try {
      await addCrew({ projectId, personId });
      toast.success("Crew member added.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setSaving(false);
    }
  }

  async function createAndAdd() {
    if (name.trim().length === 0) {
      toast.error("Give the new person a name.");
      return;
    }
    if (role.trim().length === 0) {
      toast.error("Give the new person a role.");
      return;
    }
    setSaving(true);
    try {
      const personId = await createPerson({
        name,
        role,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      await addCrew({ projectId, personId });
      toast.success(`${name.trim()} added to your people list and this project.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add crew to this project</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border pb-3">
          <Button
            size="sm"
            variant={mode === "existing" ? "secondary" : "ghost"}
            onClick={() => setMode("existing")}
          >
            From your people
          </Button>
          <Button
            size="sm"
            variant={mode === "new" ? "secondary" : "ghost"}
            onClick={() => setMode("new")}
          >
            Add a new person
          </Button>
        </div>

        {mode === "existing" ? (
          <div className="space-y-3 py-2">
            <Input
              placeholder="Search by name, role, email or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {people === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : matches.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {available.length === 0
                  ? "Everyone in your people list is already on this project."
                  : "Nothing matches that search."}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {matches.map((person) => (
                  <li key={person._id}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void choose(person._id)}
                      className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{person.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {person.role}
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[person.email, person.phone].filter(Boolean).join(" \u00b7 ") ||
                          "No contact details"}
                      </span>
                      {person.notes && (
                        <span className="truncate text-xs text-muted-foreground">
                          {person.notes}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-person-name">Name</Label>
                <Input
                  id="new-person-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-person-role">Role</Label>
                <Input
                  id="new-person-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="DP, Sound recordist…"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-person-email">Email</Label>
                <Input
                  id="new-person-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-person-phone">Phone</Label>
                <Input
                  id="new-person-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved to your people list too, so they are reusable on other productions.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {mode === "new" && (
            <Button onClick={createAndAdd} disabled={saving}>
              {saving ? "Adding…" : "Add to project"}
            </Button>
          )}
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

/** mailto: URLs are truncated by some clients past roughly this length. */
const MAILTO_SAFE_LENGTH = 1800;

function crewEmailBody(
  projectName: string,
  dateLine: string | null,
  crew: ProjectCrewMember[],
): string {
  const lines = [`Crew for ${projectName}`];
  if (dateLine) lines.push(dateLine);
  lines.push("", ...crew.map((m) => {
    const contact = [m.email, m.phone].filter(Boolean).join(" · ");
    return `- ${m.name} — ${m.role}${contact ? `\n  ${contact}` : ""}`;
  }));
  return lines.join("\n");
}

function ForwardCrewDialog({
  projectId,
  projectName,
  crew,
  onClose,
}: {
  projectId: Id<"projects">;
  projectName: string;
  crew: ProjectCrewMember[];
  onClose: () => void;
}) {
  const days = useQuery(api.shootDays.listForProject, { projectId });
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);

  const dateLine = useMemo(() => {
    const range = formatShootDateRange((days ?? []).map((d) => d.date));
    return range ? `Shoot dates: ${range}` : null;
  }, [days]);

  const subject = `Crew list — ${projectName}`;
  const [body, setBody] = useState<string | null>(null);
  const composed = body ?? crewEmailBody(projectName, dateLine, crew);

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
          <DialogTitle>Forward the crew list</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="forward-to">To (optional)</Label>
            <Input
              id="forward-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="producer@example.com"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forward-subject">Subject</Label>
            <Input id="forward-subject" value={subject} readOnly className="text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forward-body">Message</Label>
            <Textarea
              id="forward-body"
              value={composed}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Edit freely before sending — {crew.length} crew member
              {crew.length === 1 ? "" : "s"} included.
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
            <Button variant="secondary" onClick={copyToClipboard}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button render={<a href={mailtoHref} />}>Open in email client</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
