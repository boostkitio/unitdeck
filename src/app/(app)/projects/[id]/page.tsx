"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  PROJECT_STATUSES,
  ProjectStatus,
  statusBadgeClass,
  statusLabel,
} from "@/lib/project-status";
import { formatShootDateRange } from "@/lib/format-date";
import { ShootDaysSection } from "./shoot-days";
import { CrewSection } from "@/components/projects/crew-section";
import { DocumentsSection } from "@/components/documents/documents-section";
import { CallSheetSection } from "@/components/projects/call-sheet-section";

type ProjectWithClient = Doc<"projects"> & { clientName: string | null };

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
  project: ProjectWithClient;
  clients: Doc<"clients">[];
}) {
  const router = useRouter();
  const updateProject = useMutation(api.projects.update);
  const archiveProject = useMutation(api.projects.archive);
  const shootDays = useQuery(api.shootDays.listForProject, { projectId: project._id });

  const [name, setName] = useState(project.name);
  const [briefSummary, setBriefSummary] = useState(project.briefSummary ?? "");

  const shootDateRange = useMemo(
    () => (shootDays ? formatShootDateRange(shootDays.map((d) => d.date)) : null),
    [shootDays],
  );

  async function save(patch: {
    name?: string;
    clientId?: Id<"clients"> | null;
    status?: ProjectStatus;
    briefSummary?: string;
  }) {
    try {
      await updateProject({ id: project._id, ...patch });
      toast.success("Saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  }

  return (
    <div>
      {/* Summary header: name with the shoot dates alongside it, then client,
          brief and status stacked underneath. */}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.clientName ?? "No client assigned"}
          </p>
          {project.briefSummary ? (
            <p className="mt-2 max-w-2xl text-sm text-foreground/80">{project.briefSummary}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No brief summary yet.</p>
          )}
          <div className="mt-3">
            <Badge variant="secondary" className={statusBadgeClass(project.status)}>
              {statusLabel(project.status)}
            </Badge>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Shoot dates
          </p>
          {shootDays === undefined ? (
            <Skeleton className="mt-1 h-5 w-40" />
          ) : (
            <p className="mt-1 text-sm font-medium">
              {shootDateRange ?? <span className="text-muted-foreground">None scheduled</span>}
            </p>
          )}
          <div className="mt-3">
            <ArchiveDialog
              onArchive={async () => {
                await archiveProject({ id: project._id });
                toast.success("Project archived.");
                router.push("/projects");
              }}
            />
          </div>
        </div>
      </div>

      <details className="mt-6 rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Edit details</summary>
        <div className="max-w-xl space-y-6 border-t border-border px-4 py-5">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <div className="flex gap-2">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              <Button
                variant="secondary"
                onClick={() => save({ name })}
                disabled={name.trim() === project.name}
              >
                Save
              </Button>
            </div>
          </div>

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
              <SelectTrigger className="w-56">
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
            <Label htmlFor="brief">Brief summary</Label>
            <Textarea
              id="brief"
              value={briefSummary}
              onChange={(e) => setBriefSummary(e.target.value)}
              rows={5}
            />
            <Button
              variant="secondary"
              onClick={() => save({ briefSummary })}
              disabled={briefSummary === (project.briefSummary ?? "")}
            >
              Save brief
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={project.status}
              onValueChange={(value) => {
                if (value !== null) void save({ status: value as ProjectStatus });
              }}
            >
              <SelectTrigger className="w-56">
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
        </div>
      </details>

      <ShootDaysSection projectId={project._id} />
      <CrewSection projectId={project._id} />
      <DocumentsSection projectId={project._id} />
      <CallSheetSection projectId={project._id} />
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
          <Button variant="outline" size="sm">
            Archive
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
