"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { type FunctionReturnType } from "convex/server";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { displayName } from "../../../../../convex/lib/personName";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ARCHIVED_OPTION,
  PROJECT_STATUSES,
  ProjectStatus,
  statusLabel,
} from "@/lib/project-status";
import { saveStateLabel, useSyncedField } from "@/lib/use-debounced-save";
import { ProjectForecast } from "@/components/projects/project-forecast";
import { ShootDatesEditor } from "@/components/projects/shoot-dates-editor";
import { LocationSection } from "@/components/projects/location-section";
import { AccommodationSection } from "@/components/projects/accommodation-section";
import { CrewSection } from "@/components/projects/crew-section";
import { ProjectClientSection } from "@/components/projects/client-section";
import { ScheduleSection } from "@/components/projects/schedule-section";
import { EquipmentSection } from "@/components/projects/equipment-section";
import { DocumentsSection } from "@/components/documents/documents-section";
import { CallSheetSection } from "@/components/projects/call-sheet-section";

// Inferred from the query so the normalised status and resolved archived flag
// stay accurate rather than drifting from a hand-written shape.
type ProjectWithRelations = NonNullable<FunctionReturnType<typeof api.projects.getByRef>>;
// Clients arrive with their contacts already resolved, so the "booked by"
// picker does not need a query of its own per client.
type ClientWithContacts = FunctionReturnType<typeof api.clients.list>[number];

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // The URL holds a job number now, and a document id on links made before
  // job numbers existed. The query reads either.
  const { id } = use(params);
  const { organization } = useOrganization();
  const project = useQuery(api.projects.getByRef, organization ? { ref: id } : "skip");
  const clients = useQuery(api.clients.list, organization ? {} : "skip");

  if (project === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (project === null) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Project not found.</p>;
  }

  // Keyed by project id so form state resets if the route changes project.
  return <ProjectEditor key={project._id} project={project} clients={clients ?? []} />;
}

function ProjectEditor({
  project,
  clients,
}: {
  project: ProjectWithRelations;
  clients: ClientWithContacts[];
}) {
  const router = useRouter();
  const updateProject = useMutation(api.projects.update);
  const setArchived = useMutation(api.projects.setArchived);
  const deleteProject = useMutation(api.projects.remove);

  const [jobNumber, setJobNumber] = useState(project.jobNumber ?? "");

  const saveName = useCallback(
    async (value: string) => {
      await updateProject({ id: project._id, name: value });
    },
    [updateProject, project._id],
  );
  const saveBrief = useCallback(
    async (value: string) => {
      await updateProject({ id: project._id, briefSummary: value });
    },
    [updateProject, project._id],
  );

  // Both of these follow the stored value while nobody is typing in them, so
  // a change made by somebody else in the same project appears here rather
  // than being written back over. A blank name is rejected server-side, so it
  // is held rather than fired off per keypress.
  const {
    value: name,
    setValue: setName,
    state: nameState,
  } = useSyncedField(project.name, saveName, { canSave: (v) => v.trim().length > 0 });
  const {
    value: briefSummary,
    setValue: setBriefSummary,
    state: briefState,
  } = useSyncedField(project.briefSummary ?? "", saveBrief);

  /**
   * The job number addresses the project in the URL, so a change moves the
   * page with it rather than leaving the address pointing at the old one.
   */
  async function saveJobNumber() {
    const next = jobNumber.trim();
    if (next === (project.jobNumber ?? "")) return;
    if (next.length === 0) {
      setJobNumber(project.jobNumber ?? "");
      return;
    }
    try {
      await updateProject({ id: project._id, jobNumber: next });
      toast.success(`Job number ${next}.`);
      router.replace(`/projects/${encodeURIComponent(next)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the job number.");
      setJobNumber(project.jobNumber ?? "");
    }
  }

  /**
   * The dropdown offers Archived alongside the booking statuses, so choosing
   * it sets the flag, and choosing a real status clears it again.
   */
  async function changeStatus(value: string) {
    try {
      if (value === ARCHIVED_OPTION.value) {
        await setArchived({ id: project._id, archived: true });
        toast.success("Project archived.");
        return;
      }
      await updateProject({ id: project._id, status: value as ProjectStatus });
      if (project.archived) await setArchived({ id: project._id, archived: false });
      toast.success("Saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  }

  async function save(patch: {
    clientId?: Id<"clients"> | null;
    status?: ProjectStatus;
    bookedByContact?: number | null;
    ownerId?: string | null;
  }) {
    try {
      await updateProject({ id: project._id, ...patch });
      toast.success("Saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  }

  return (
    <div className="pb-8">
      {project.archived && (
        <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
          Archived project — kept for reference. Restore it at the bottom of this page.
        </div>
      )}
      {/* The title is the name field — editing it here is the only place it is set */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 px-2 pb-1">
            <label htmlFor="project-job-number" className="text-xs text-muted-foreground">
              Job
            </label>
            <input
              id="project-job-number"
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              onBlur={() => void saveJobNumber()}
              placeholder="Unnumbered"
              className="w-28 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs tracking-tight outline-none transition-colors hover:border-border focus:border-border focus:bg-background"
            />
          </div>
          <label htmlFor="project-name" className="sr-only">
            Project name
          </label>
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled project"
            className="w-full max-w-xl rounded-md border border-transparent bg-transparent px-2 py-1 font-heading text-2xl font-semibold tracking-tight outline-none transition-colors hover:border-border focus:border-border focus:bg-background sm:text-3xl"
          />
          <p className="h-4 px-2 text-xs text-muted-foreground">
            {name.trim().length === 0
              ? "A project needs a name"
              : (saveStateLabel(nameState) ?? "")}
          </p>
          <ProjectForecast
            projectId={project._id}
            forecast={project.forecast}
            date={project.forecastDate}
            locationId={project.forecastLocationId}
            locationName={project.location?.name ?? null}
          />
        </div>
        <ShootDatesEditor projectId={project._id} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <BookedBy project={project} clients={clients} onSave={save} />

          <ProjectOwner project={project} onSave={save} />

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="brief">Brief summary</Label>
              <span className="text-xs text-muted-foreground">
                {saveStateLabel(briefState) ?? ""}
              </span>
            </div>
            <Textarea
              id="brief"
              value={briefSummary}
              onChange={(e) => setBriefSummary(e.target.value)}
              rows={5}
              className="max-w-2xl"
            />
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={project.archived ? ARCHIVED_OPTION.value : project.status}
              onValueChange={(value) => {
                if (value !== null) void changeStatus(value);
              }}
            >
              <SelectTrigger className="w-64">
                {/* Explicit label: Base UI shows the raw value when items mount late */}
                <SelectValue>
                  {project.archived ? ARCHIVED_OPTION.label : statusLabel(project.status)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
                <SelectItem value={ARCHIVED_OPTION.value}>{ARCHIVED_OPTION.label}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <LocationSection projectId={project._id} location={project.location} />
      <AccommodationSection projectId={project._id} />
      <CrewSection projectId={project._id} projectName={project.name} kind="crew" />
      <CrewSection projectId={project._id} projectName={project.name} kind="talent" />
      <ProjectClientSection
        projectId={project._id}
        clientId={project.clientId ?? null}
        clientName={project.clientName}
      />
      <ScheduleSection projectId={project._id} />
      <EquipmentSection projectId={project._id} />
      <DocumentsSection projectId={project._id} />
      <CallSheetSection
        projectId={project._id}
        projectRef={project.jobNumber ?? project._id}
      />

      {/* Destructive action, deliberately last */}
      <div className="mt-16 border-t border-border pt-6">
        {project.archived ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              This project is archived. Its crew, location and documents are all still here.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await setArchived({ id: project._id, archived: false });
                  toast.success("Project restored.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not restore it.");
                }
              }}
            >
              Restore project
            </Button>
            <DeleteProjectDialog
              projectName={project.name}
              onDelete={async () => {
                const result = await deleteProject({ id: project._id });
                toast.success(`${project.name} deleted.`, {
                  description: `${result.deleted} record${result.deleted === 1 ? "" : "s"} removed.`,
                });
                router.push("/projects");
              }}
            />
          </div>
        ) : (
          <ArchiveDialog
            onArchive={async () => {
              await setArchived({ id: project._id, archived: true });
              toast.success("Project archived.");
              router.push("/projects");
            }}
          />
        )}
      </div>
    </div>
  );
}

function ArchiveDialog({ onArchive }: { onArchive: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm">
            Archive project
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this project?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The project moves to archived status and disappears from active lists. Nothing is
          deleted, and you can restore it by changing its status back.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onArchive();
              } finally {
                setBusy(false);
                setOpen(false);
              }
            }}
          >
            {busy ? "Archiving…" : "Archive project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deleting is not reversible, so it asks for the project's name to be typed.
 * Archiving is the undo-able step and sits before this one; anything that
 * removes a production's records for good should be hard to do by accident.
 */
function DeleteProjectDialog({
  projectName,
  onDelete,
}: {
  projectName: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  // One short word, not the whole title: enough of a pause to stop a stray
  // click, without making the user copy a project name back to itself.
  const confirmed = typed.trim().toLowerCase() === "delete";

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete it.");
      setDeleting(false);
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete permanently
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => (!o ? setOpen(false) : undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {projectName}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                This removes the project and everything that belongs only to it — its shoot
                days, crew bookings, equipment list and documents. It cannot be undone.
              </p>
              <p className="text-sm text-muted-foreground">
                Your people, clients, locations and equipment list are company records and are
                not touched.
              </p>
              <div className="space-y-2">
                <Label htmlFor="confirm-delete">
                  Type <span className="font-medium text-foreground">delete</span> to confirm
                </Label>
                <Input
                  id="confirm-delete"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="delete"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && confirmed) {
                      e.preventDefault();
                      void handleDelete();
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!confirmed || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * Who booked the job, and how to reach them.
 *
 * A client is a company; the person who actually rings you is one of several
 * there, and which one it was is a fact about this production rather than
 * about the company. Picking them here puts their number and address on the
 * project, which is where anyone looks for it mid-shoot.
 */
/**
 * Not a client id, so it can never collide with one. Picking it opens the
 * dialog rather than saving anything.
 */
const NEW_CLIENT = "__new_client__";

function BookedBy({
  project,
  clients,
  onSave,
}: {
  project: ProjectWithRelations;
  clients: ClientWithContacts[];
  onSave: (patch: { clientId?: Id<"clients"> | null; bookedByContact?: number | null }) => void;
}) {
  const client = clients.find((c) => c._id === project.clientId) ?? null;
  const contacts = client?.contacts ?? [];
  const chosen = project.bookedByContact ?? null;
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      <Label>Booked by</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={project.clientId ?? "none"}
          onValueChange={(value) => {
            // The sentinel is not a client, so nothing is saved for it: the
            // select falls back to what the project already says while the
            // dialog is open.
            if (value === NEW_CLIENT) {
              setAdding(true);
              return;
            }
            onSave({
              clientId: value === "none" || value === null ? null : (value as Id<"clients">),
            });
          }}
        >
          <SelectTrigger className="w-64">
            {/* Explicit label: Base UI shows the raw value when items mount late */}
            <SelectValue>{client ? client.name : "No client"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No client</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
            <SelectItem value={NEW_CLIENT}>+ Add a new client…</SelectItem>
          </SelectContent>
        </Select>

        {client && contacts.length > 0 && (
          <Select
            value={chosen === null ? "none" : String(chosen)}
            onValueChange={(value) =>
              onSave({
                bookedByContact: value === "none" || value === null ? null : Number(value),
              })
            }
          >
            <SelectTrigger className="w-64">
              <SelectValue>
                {chosen !== null && contacts[chosen]
                  ? contactLabel(contacts[chosen])
                  : "Nobody in particular"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nobody in particular</SelectItem>
              {contacts.map((contact, i) => (
                <SelectItem key={i} value={String(i)}>
                  {contactLabel(contact)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {client && contacts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No contacts at {client.name} yet — add one in the Client box below.
        </p>
      )}

      {adding && (
        <NewClientDialog
          onClose={() => setAdding(false)}
          onCreated={(clientId, hasContact) =>
            // Somebody written here booked the job, so they are the contact
            // as well as the first name in the client's book.
            onSave({ clientId, bookedByContact: hasContact ? 0 : null })
          }
        />
      )}
    </div>
  );
}

function contactLabel(contact: { name: string; role?: string }): string {
  return contact.role ? `${contact.name} — ${contact.role}` : contact.name;
}

/**
 * A new client, written from the project rather than from the Clients tab.
 *
 * A job usually arrives from somebody who is not in the book yet, and going
 * to another page to file them before the project can name them is a detour.
 * What is written here is a real client record — the same `clients.create`
 * the Clients tab calls — so it is in the database, not attached to this one
 * production.
 */
function NewClientDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** The new client, and whether a contact was named for it. */
  onCreated: (clientId: Id<"clients">, hasContact: boolean) => void;
}) {
  const create = useMutation(api.clients.create);
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (company.trim().length === 0) {
      toast.error("A client needs a company name.");
      return;
    }
    setSaving(true);
    try {
      const hasContact = name.trim().length > 0;
      const clientId = await create({
        name: company.trim(),
        contacts: hasContact
          ? [
              {
                name: name.trim(),
                role: role.trim() || undefined,
                phone: phone.trim() || undefined,
                email: email.trim() || undefined,
              },
            ]
          : undefined,
        notes: notes.trim() || undefined,
      });
      onCreated(clientId, hasContact);
      toast.success(`${company.trim()} added to your clients.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-client-company">Company</Label>
            <Input
              id="new-client-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Who you are invoicing"
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-client-name">Contact</Label>
              <Input
                id="new-client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who booked it"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-role">Role</Label>
              <Input
                id="new-client-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Producer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-phone">Phone</Label>
              <Input
                id="new-client-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-email">Email</Label>
              <Input
                id="new-client-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-client-notes">Notes</Label>
            <Textarea
              id="new-client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about them"
              rows={2}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            This goes in your clients database, not just on this project. The
            company is all that is needed now — the rest can be filled in later
            from the Clients tab.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Adding…" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Who on the team owns this production.
 *
 * Not who booked it — that is the client's contact — but the colleague to ask
 * when whoever booked it is on a shoot. Drawn from the organisation's members
 * rather than the contacts book, because this is someone with a login.
 */
function ProjectOwner({
  project,
  onSave,
}: {
  // Only the field this control owns: the page's project is an enriched query
  // result, not a raw document.
  project: { ownerId?: string | null };
  onSave: (patch: { ownerId?: string | null }) => void | Promise<void>;
}) {
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const members = memberships?.data ?? [];
  // Names people set inside UnitDeck, which take precedence over Clerk's —
  // Clerk's are blank unless the instance has Name enabled.
  const profiles = useQuery(api.memberProfiles.listForOrg, {});
  const NONE = "none";

  const nameOf = (userId: string) => {
    const member = members.find((m) => m.publicUserData?.userId === userId);
    if (!member) return "Someone who has since left";
    const data = member.publicUserData;
    return displayName({
      chosen: profiles?.find((p) => p.userId === userId),
      fromAuth: data,
      email: data?.identifier,
    });
  };

  return (
    <div className="space-y-2">
      <Label>Owner</Label>
      <Select
        value={project.ownerId ?? NONE}
        onValueChange={(value) => {
          if (value === null) return;
          void onSave({ ownerId: value === NONE ? null : value });
        }}
      >
        <SelectTrigger className="w-64">
          {/* Explicit label: Base UI shows the raw value, which here is a user id. */}
          <SelectValue>
            {project.ownerId ? nameOf(project.ownerId) : "Nobody yet"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Nobody yet</SelectItem>
          {members.map((m) => {
            const userId = m.publicUserData?.userId;
            if (!userId) return null;
            return (
              <SelectItem key={userId} value={userId}>
                {nameOf(userId)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Who to ask about this job when whoever booked it is away.
      </p>
    </div>
  );
}
