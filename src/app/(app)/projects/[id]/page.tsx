"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
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
import { PROJECT_STATUSES, ProjectStatus } from "@/lib/project-status";

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
    return <p className="py-12 text-center text-sm text-neutral-500">Project not found.</p>;
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

  const [name, setName] = useState(project.name);
  const [briefSummary, setBriefSummary] = useState(project.briefSummary ?? "");

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
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <ArchiveDialog
          onArchive={async () => {
            await archiveProject({ id: project._id });
            toast.success("Project archived.");
            router.push("/projects");
          }}
        />
      </div>
      <p className="mt-1 text-sm text-neutral-500">{project.clientName ?? "No client assigned"}</p>

      <div className="mt-8 max-w-xl space-y-6">
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
              <SelectValue placeholder="No client" />
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
          <Button variant="outline" size="sm">
            Archive
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this project?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-neutral-500">
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
