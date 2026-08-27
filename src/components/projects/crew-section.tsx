"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { GripVerticalIcon } from "lucide-react";
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
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { cn } from "@/lib/utils";
import { EmailLink, PhoneLink } from "@/components/contact-link";
import { formatShootDateRange } from "@/lib/format-date";
import { ReleaseComposer } from "@/components/documents/release-composer";
import { dropIndex, moveToSlot } from "@/lib/reorder";

// "order" is the arranged order — director first, camera together — which the
// query already returns. It is the default view; a column sort is a temporary
// override, and the reorder controls hide while one is active because dragging
// a row inside a sorted table cannot mean anything.
type CrewSortKey = "order" | "name" | "role" | "status" | "email" | "phone";

function crewSortValue(member: ProjectCrewMember, key: CrewSortKey): string | number | null {
  switch (key) {
    case "order":
      // Every row equal, so the stable sort leaves the query order alone.
      return 0;
    case "name":
      return member.name;
    case "role":
      return member.role;
    case "status":
      // Still-to-confirm first when ascending, which is the order that matters.
      return member.status === "confirmed" ? 1 : 0;
    case "email":
      return member.email;
    case "phone":
      return member.phone;
  }
}

export function CrewSection({
  projectId,
  projectName,
  kind = "crew",
}: {
  projectId: Id<"projects">;
  projectName: string;
  /** Which list this card is: crew and talent are separate boxes, because a
   *  call sheet keeps them apart. */
  kind?: "crew" | "talent";
}) {
  const all = useQuery(api.projectCrew.listForProject, { projectId });
  const crew = all?.filter((m) => m.kind === kind);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectCrewMember | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [filling, setFilling] = useState<ProjectCrewMember | null>(null);
  const [releaseId, setReleaseId] = useState<Id<"documents"> | null>(null);
  const [makingRelease, setMakingRelease] = useState<Id<"people"> | null>(null);

  const unfilled = (crew ?? []).filter((m) => m.personId === null).length;
  const outstanding = (crew ?? []).filter(
    (m) => m.personId !== null && m.status !== "confirmed",
  ).length;
  const { sort, toggle } = useTableSort<CrewSortKey>({ key: "order", dir: "asc" });
  const sortedCrew = useMemo(() => sortRows(crew ?? [], sort, crewSortValue), [crew, sort]);
  const reorderCrew = useMutation(api.projectCrew.reorder);
  const arranging = sort.key === "order";

  // Dragging, by pointer events rather than HTML5 drag-and-drop, because the
  // latter does nothing at all on a touch screen and this list is read on set.
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragSlot, setDragSlot] = useState<number | null>(null);

  function slotUnder(clientY: number): number {
    const midpoints = rowRefs.current.slice(0, sortedCrew.length).flatMap((row) => {
      if (!row) return [];
      const rect = row.getBoundingClientRect();
      return [rect.top + rect.height / 2];
    });
    return dropIndex(midpoints, clientY);
  }

  function startDrag(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    // The handle keeps the pointer for the whole drag, so leaving the row —
    // or the table — does not drop it half way.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragFrom(index);
    setDragSlot(index);
  }

  function onDragMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragFrom === null) return;
    setDragSlot(slotUnder(event.clientY));
  }

  async function endDrag() {
    const from = dragFrom;
    const slot = dragSlot;
    setDragFrom(null);
    setDragSlot(null);
    if (from === null || slot === null) return;
    const next = moveToSlot(sortedCrew, from, slot);
    // Dropped back where it started: nothing to write.
    if (next === sortedCrew) return;
    try {
      await reorderCrew({ projectId, orderedIds: next.map((m) => m._id) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reorder the crew.");
    }
  }
  const removeCrew = useMutation(api.projectCrew.remove);
  const updateCrew = useMutation(api.projectCrew.update);
  const ensureRelease = useMutation(api.documents.ensureForPerson);
  // Only the talent card needs releases, so only it asks for them.
  const releases = useQuery(
    api.documents.listForProject,
    kind === "talent" ? { projectId } : "skip",
  );

  /** The release already raised for somebody on this production, if any. */
  function releaseFor(personId: Id<"people"> | null) {
    if (!personId) return undefined;
    return (releases ?? []).find(
      (doc) => doc.signer.personId === personId && doc.status !== "voided",
    );
  }

  /**
   * Open the release for this person, raising it first if there is not one.
   * Everything on it — their name, their email, the production, the producer
   * — is already known here, so none of it is asked for again.
   */
  async function openRelease(personId: Id<"people">) {
    setMakingRelease(personId);
    try {
      setReleaseId(await ensureRelease({ projectId, personId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the release.");
    } finally {
      setMakingRelease(null);
    }
  }

  async function toggleStatus(member: ProjectCrewMember) {
    try {
      await updateCrew({
        id: member._id,
        status: member.status === "confirmed" ? "pencilled" : "confirmed",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update them.");
    }
  }

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
        <CardTitle>{kind === "talent" ? "Talent" : "Crew"}</CardTitle>
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
              {kind === "talent" ? "Add talent" : "Add crew"}
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
            {kind === "talent" ? "No talent on this production yet." : "No crew on this production yet."} Add from your{" "}
            <Link
              href={kind === "talent" ? "/talent" : "/people"}
              className="underline underline-offset-2 text-foreground"
            >
              {kind === "talent" ? "talent" : "people"}
            </Link>{" "}
            list.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {arranging && <TableHead className="w-px" />}
                <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} />
                <SortableHead
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onSort={toggle}
                  className="w-32"
                />
                <SortableHead label="Email" sortKey="email" sort={sort} onSort={toggle} />
                <SortableHead label="Phone" sortKey="phone" sort={sort} onSort={toggle} />
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCrew.map((member, index) => (
                <TableRow
                  key={member._id}
                  ref={(row) => {
                    rowRefs.current[index] = row;
                  }}
                  className={cn(
                    dragFrom === index && "opacity-40",
                    // The line the row will land on, drawn on whichever side
                    // of the gap it belongs to.
                    dragFrom !== null &&
                      dragSlot === index &&
                      "shadow-[inset_0_2px_0_0_var(--color-primary)]",
                    dragFrom !== null &&
                      dragSlot === sortedCrew.length &&
                      index === sortedCrew.length - 1 &&
                      "shadow-[inset_0_-2px_0_0_var(--color-primary)]",
                  )}
                >
                  {arranging && (
                    <TableCell className="w-px pr-0 align-middle">
                      <button
                        type="button"
                        aria-label={`Drag ${member.name ?? member.role} to reorder`}
                        // touch-none stops the browser scrolling the page
                        // instead of handing us the drag.
                        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
                        onPointerDown={(e) => startDrag(index, e)}
                        onPointerMove={onDragMove}
                        onPointerUp={() => void endDrag()}
                        onPointerCancel={() => void endDrag()}
                      >
                        <GripVerticalIcon className="size-4" />
                      </button>
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    {member.name ?? (
                      <span className="text-muted-foreground italic">Nobody booked</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{member.role}</TableCell>
                  <TableCell>
                    {member.personId === null ? (
                      // Nothing to confirm until somebody is in the role.
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/60 dark:text-red-300">
                        To book
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void toggleStatus(member)}
                        title="Click to change"
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                          member.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
                        )}
                      >
                        {member.status === "confirmed" ? "Confirmed" : "Pencilled"}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <EmailLink email={member.email} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <PhoneLink phone={member.phone} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {member.personId === null && (
                        <Button variant="ghost" size="sm" onClick={() => setFilling(member)}>
                          Book someone
                        </Button>
                      )}
                      {kind === "talent" && member.personId !== null && (
                        <ReleaseCell
                          release={releaseFor(member.personId)}
                          busy={makingRelease === member.personId}
                          onOpen={() => void openRelease(member.personId!)}
                        />
                      )}
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
        {crew !== undefined && crew.length > 0 && (unfilled > 0 || outstanding > 0) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {[
              unfilled > 0 && `${unfilled} role${unfilled === 1 ? "" : "s"} still to book`,
              outstanding > 0 && `${outstanding} still to confirm`,
            ]
              .filter(Boolean)
              .join(" · ")}
            .
          </p>
        )}
        {crew !== undefined && crew.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
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
          initialKind={kind}
          existing={all ?? []}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <EditCrewDialog
          member={editing}
          onBook={() => {
            // Straight from editing the role into booking it, without
            // deleting the role and starting again.
            setFilling(editing);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {filling && (
        <FillRoleDialog
          role={filling}
          existing={crew ?? []}
          onClose={() => setFilling(null)}
        />
      )}
      {releaseId && (
        <ReleaseComposer id={releaseId} onClose={() => setReleaseId(null)} />
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

/**
 * Searchable list of people not already on the project. Shared by adding crew
 * and by filling a role that was left open.
 */
function PersonPicker({
  taken,
  disabled,
  onPick,
  book,
  onBookChange,
}: {
  taken: (Id<"people"> | null)[];
  disabled: boolean;
  onPick: (personId: Id<"people">) => void;
  /** Which contact book is being picked from. */
  book: "crew" | "talent";
  onBookChange: (book: "crew" | "talent") => void;
}) {
  const people = useQuery(api.people.list, { kind: book });
  const [search, setSearch] = useState("");

  const available = useMemo(() => {
    const used = new Set(taken.filter((id): id is Id<"people"> => id !== null).map(String));
    return (people ?? []).filter((p) => !used.has(p._id));
  }, [people, taken]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length === 0) return available;
    return available.filter((p) =>
      [p.name, p.role, p.email ?? "", p.phone ?? ""].some((field) =>
        field.toLowerCase().includes(term),
      ),
    );
  }, [available, search]);

  if (people === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Both books from one window: adding a presenter should not mean
          closing this and going somewhere else. */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={book === "crew" ? "secondary" : "ghost"}
          onClick={() => onBookChange("crew")}
        >
          People
        </Button>
        <Button
          size="sm"
          variant={book === "talent" ? "secondary" : "ghost"}
          onClick={() => onBookChange("talent")}
        >
          Talent
        </Button>
      </div>
      <Input
        placeholder="Search by name, role, email or phone…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {matches.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {available.length === 0
            ? `Everyone in your ${book === "talent" ? "talent" : "people"} list is already on this project.`
            : "Nothing matches that search."}
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {matches.map((person) => (
            <li key={person._id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(person._id)}
                className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{person.name}</span>
                  <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                    {person.role}
                  </span>
                </span>
                <span className="block w-full truncate text-xs text-muted-foreground">
                  {[person.email, person.phone].filter(Boolean).join(" \u00b7 ") ||
                    "No contact details"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddCrewDialog({
  projectId,
  existing,
  initialKind,
  onClose,
}: {
  projectId: Id<"projects">;
  existing: ProjectCrewMember[];
  /** Which card opened it, so it starts on the right book. */
  initialKind: "crew" | "talent";
  onClose: () => void;
}) {
  const addCrew = useMutation(api.projectCrew.add);
  const createPerson = useMutation(api.people.create);

  const [mode, setMode] = useState<"existing" | "new" | "role">("existing");
  const [kind, setKind] = useState<"crew" | "talent">(initialKind);
  const [saving, setSaving] = useState(false);

  // New-person fields, so someone can be added without leaving the dialog.
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Role-only slot.
  const [openRole, setOpenRole] = useState("");

  async function choose(personId: Id<"people">) {
    setSaving(true);
    try {
      await addCrew({ projectId, personId, kind });
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
      await addCrew({ projectId, personId, kind });
      toast.success(`${name.trim()} added to your people list and this project.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setSaving(false);
    }
  }

  async function addOpenRole() {
    if (openRole.trim().length === 0) {
      toast.error("Name the role you need to fill.");
      return;
    }
    setSaving(true);
    try {
      await addCrew({ projectId, role: openRole, kind });
      toast.success(`${openRole.trim()} added — nobody booked into it yet.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the role.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-full max-w-xl overflow-y-auto sm:p-5">
        <DialogHeader>
          <DialogTitle>Add to this project</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
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
          <Button
            size="sm"
            variant={mode === "role" ? "secondary" : "ghost"}
            onClick={() => setMode("role")}
          >
            Role to fill later
          </Button>
        </div>

        {mode === "existing" && (
          <div className="py-2">
            <PersonPicker
              taken={existing.map((m) => m.personId)}
              disabled={saving}
              onPick={(personId) => void choose(personId)}
              book={kind}
              onBookChange={setKind}
            />
          </div>
        )}

        {mode === "new" && (
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

        {mode === "role" && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="open-role">Role</Label>
              <Input
                id="open-role"
                value={openRole}
                onChange={(e) => setOpenRole(e.target.value)}
                placeholder="Gaffer, Runner, Makeup artist…"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Adds the role with nobody in it, so the gap stays visible until you book
              someone. It counts as still to book on the dashboard.
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
          {mode === "role" && (
            <Button onClick={addOpenRole} disabled={saving}>
              {saving ? "Adding…" : "Add role"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FillRoleDialog({
  role,
  existing,
  onClose,
}: {
  role: ProjectCrewMember;
  existing: ProjectCrewMember[];
  onClose: () => void;
}) {
  const assign = useMutation(api.projectCrew.assign);
  const [book, setBook] = useState<"crew" | "talent">("crew");
  const [saving, setSaving] = useState(false);

  async function pick(personId: Id<"people">) {
    setSaving(true);
    try {
      await assign({ id: role._id, personId });
      toast.success(`${role.role} filled.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not book them.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-full max-w-xl overflow-y-auto sm:p-5">
        <DialogHeader>
          <DialogTitle>Book someone as {role.role}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <PersonPicker
            taken={existing.map((m) => m.personId)}
            disabled={saving}
            onPick={(personId) => void pick(personId)}
            book={book}
            onBookChange={setBook}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCrewDialog({
  member,
  onBook,
  onClose,
}: {
  member: ProjectCrewMember;
  /** Offered when the role has nobody in it yet. */
  onBook: () => void;
  onClose: () => void;
}) {
  const updateCrew = useMutation(api.projectCrew.update);
  const [role, setRole] = useState(member.role);
  const [notes, setNotes] = useState(member.notes ?? "");
  const [kind, setKind] = useState<"crew" | "talent">(member.kind);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateCrew({
        id: member._id,
        // Blank clears the override and falls back to their usual role.
        role: role.trim() || null,
        notes: notes.trim() || null,
        kind,
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
          {/* An unfilled role has no name to show, so it is titled by the
              role it is waiting on. */}
          <DialogTitle>{member.name ?? member.role ?? "Role"}</DialogTitle>
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
            <Label>Type</Label>
            <div className="flex gap-2">
              <Button
                variant={kind === "crew" ? "default" : "outline"}
                size="sm"
                onClick={() => setKind("crew")}
              >
                Crew
              </Button>
              <Button
                variant={kind === "talent" ? "default" : "outline"}
                size="sm"
                onClick={() => setKind("talent")}
              >
                Talent
              </Button>
            </div>
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
          {member.personId === null ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">Nobody is in this role yet.</p>
              <Button variant="secondary" size="sm" onClick={onBook}>
                Book someone
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Name, email and phone live on their{" "}
              <Link href="/people" className="underline underline-offset-2">
                people
              </Link>{" "}
              record.
            </p>
          )}
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
    if (m.name === null) return `- ${m.role} — STILL TO BOOK`;
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

/**
 * The release for one of the talent, at whatever stage it has reached.
 *
 * A draft is still being written, so it opens for editing. Once it has gone
 * out it is a legal document rather than a form, and what happens to it —
 * chasing, previewing, downloading the signed copy — belongs in Documents
 * further down the page. This says where it has got to and stops there.
 */
function ReleaseCell({
  release,
  busy,
  onOpen,
}: {
  release: { _id: Id<"documents">; status: string } | undefined;
  busy: boolean;
  onOpen: () => void;
}) {
  // Out and waiting: what is wanted now is not the form but another nudge.
  if (release?.status === "sent") {
    return <ReminderButton id={release._id} />;
  }
  if (release && release.status !== "draft") {
    return (
      <span
        title="See Documents below to preview or download it"
        className="px-2 text-xs text-muted-foreground"
      >
        Release {release.status}
      </span>
    );
  }
  // The brand colour rather than a ghost: a release is a thing to go and do,
  // not a quiet action sitting among Edit and Remove.
  return (
    <Button variant="default" size="sm" disabled={busy} onClick={onOpen}>
      {busy ? "Opening…" : release ? "Edit release form" : "Release form"}
    </Button>
  );
}

/**
 * Send the release again to somebody who has had it and not signed.
 *
 * The same email, arriving a second time and saying so — which is all a
 * reminder is.
 */
export function ReminderButton({ id }: { id: Id<"documents"> }) {
  const resend = useMutation(api.documents.resendInvite);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await resend({ id });
      toast.success("Reminder sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the reminder.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Button variant="default" size="sm" disabled={sending} onClick={() => void send()}>
      {sending ? "Sending…" : "Send reminder"}
    </Button>
  );
}
