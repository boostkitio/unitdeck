"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { type FunctionReturnType } from "convex/server";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { PROJECT_STATUSES, ProjectStatus } from "@/lib/project-status";
import { saveStateLabel, useDebouncedSave } from "@/lib/use-debounced-save";
import { ShootDatesEditor } from "@/components/projects/shoot-dates-editor";
import { LocationSection } from "@/components/projects/location-section";
import { CrewSection } from "@/components/projects/crew-section";
import { EquipmentSection } from "@/components/projects/equipment-section";
import { DocumentsSection } from "@/components/documents/documents-section";

// Inferred from the query so the normalised status and resolved archived flag
// stay accurate rather than drifting from a hand-written shape.
type ProjectWithRelations = NonNullable<FunctionReturnType<typeof api.projects.get>>;

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const projectId = id as Id<"projects">;
  const { organization } = useOrganization();
  const project = useQuery(api.projects.get, organization ? { id: projectId } : "skip");
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
  clients: Doc<"clients">[];
}) {
  const router = useRouter();
  const updateProject = useMutation(api.projects.update);
  const setArchived = useMutation(api.projects.setArchived);

  const [name, setName] = useState(project.name);
  const [briefSummary, setBriefSummary] = useState(project.briefSummary ?? "");

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

  // A blank name is rejected server-side, so hold the last stored value until
  // there is something to save rather than firing a doomed request per keypress.
  const nameToSave = name.trim().length === 0 ? project.name : name;
  const nameState = useDebouncedSave(nameToSave, project.name, saveName);
  const briefState = useDebouncedSave(briefSummary, project.briefSummary ?? "", saveBrief);

  async function save(patch: { clientId?: Id<"clients"> | null; status?: ProjectStatus }) {
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
        </div>
        <ShootDatesEditor projectId={project._id} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Client</Label>
            <Select
              value={project.clientId ?? "none"}
              onValueChange={(value) =>
                void save({
                  clientId: value === "none" || value === null ? null : (value as Id<"clients">),
                })
              }
            >
              <SelectTrigger className="w-64">
                {/* Explicit label: Base UI shows the raw value when items mount late */}
                <SelectValue>
                  {project.clientId
                    ? (clients.find((c) => c._id === project.clientId)?.name ?? "…")
                    : "No client"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No client</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              value={project.status}
              onValueChange={(value) => {
                if (value !== null) void save({ status: value as ProjectStatus });
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <LocationSection projectId={project._id} location={project.location} />
      <CrewSection projectId={project._id} projectName={project.name} />
      <EquipmentSection projectId={project._id} />
      <DocumentsSection projectId={project._id} />

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
