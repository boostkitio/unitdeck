"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel, STATUS_BADGE_CLASSES, ProjectStatus } from "@/lib/project-status";
import { BriefDialog } from "@/components/agents/brief-dialog";

export default function ProjectsPage() {
  const { organization } = useOrganization();
  const projects = useQuery(api.projects.list, organization ? {} : "skip");
  const [briefOpen, setBriefOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-neutral-500">Every production, from brief to delivery.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setBriefOpen(true)}>
            New from brief
          </Button>
          <CreateProjectDialog />
        </div>
      </div>
      {briefOpen && <BriefDialog onClose={() => setBriefOpen(false)} />}

      <div className="mt-6">
        {projects === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : projects.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutral-500">
            No projects yet. Create your first one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p._id}>
                  <TableCell>
                    <Link href={`/projects/${p._id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-neutral-500">{p.clientName ?? "·"}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={STATUS_BADGE_CLASSES[p.status as ProjectStatus]}
                    >
                      {statusLabel(p.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState<string>("none");
  const [briefSummary, setBriefSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const { organization } = useOrganization();
  const clients = useQuery(api.clients.list, organization ? {} : "skip");
  const createProject = useMutation(api.projects.create);

  async function handleCreate() {
    if (name.trim().length === 0) {
      toast.error("Give the project a name.");
      return;
    }
    setSaving(true);
    try {
      await createProject({
        name,
        clientId: clientId === "none" ? undefined : (clientId as Id<"clients">),
        briefSummary: briefSummary.trim() || undefined,
      });
      toast.success("Project created.");
      setOpen(false);
      setName("");
      setClientId("none");
      setBriefSummary("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>New project</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring brand film"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={(value) => setClientId(value ?? "none")}>
              <SelectTrigger>
                <SelectValue placeholder="No client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No client</SelectItem>
                {(clients ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-brief">Brief summary (optional)</Label>
            <Textarea
              id="project-brief"
              value={briefSummary}
              onChange={(e) => setBriefSummary(e.target.value)}
              placeholder="What the client wants, in a couple of sentences"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
