"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PROJECT_STATUSES, statusLabel, statusBadgeClass } from "@/lib/project-status";
import { formatShootDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { BriefDialog } from "@/components/agents/brief-dialog";

type SortKey = "name" | "client" | "date" | "status";

/** The shape the table sorts on; the query returns a superset of this. */
type SortableProject = {
  name: string;
  clientName: string | null;
  status: string;
  nextShootDate: string | null;
  lastShootDate: string | null;
};

const STATUS_ORDER = new Map(PROJECT_STATUSES.map((s, i) => [s.value as string, i]));

/**
 * The date shown for a project: its next shoot day, falling back to the last
 * one on the books once the whole production is behind us.
 */
function rowDate(p: SortableProject): string | null {
  return p.nextShootDate ?? p.lastShootDate;
}

function sortValue(p: SortableProject, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return p.name;
    case "client":
      return p.clientName;
    case "date":
      return rowDate(p);
    case "status":
      return STATUS_ORDER.get(p.status) ?? 99;
  }
}

export default function ProjectsPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const [showArchived, setShowArchived] = useState(false);
  const projects = useQuery(
    api.projects.list,
    organization ? (showArchived ? { archivedOnly: true } : {}) : "skip",
  );
  const archived = useQuery(api.projects.list, organization ? { archivedOnly: true } : "skip");
  const legacyCount = useQuery(api.projects.legacyStatusCount, organization ? {} : "skip");
  const migrateStatuses = useMutation(api.projects.migrateStatuses);
  const [migrating, setMigrating] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);

  async function handleMigrate() {
    setMigrating(true);
    try {
      const result = await migrateStatuses({});
      toast.success(`Updated ${result.migrated} project${result.migrated === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update them.");
    } finally {
      setMigrating(false);
    }
  }
  const { sort, toggle } = useTableSort<SortKey>({ key: "date", dir: "asc" });

  const sorted = useMemo(
    () => (projects === undefined ? undefined : sortRows(projects, sort, sortValue)),
    [projects, sort],
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {showArchived ? "Archived projects" : "Projects"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {showArchived
              ? "Kept for reference — crew, location and documents are all still there."
              : "Every production, from brief to delivery."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setBriefOpen(true)}>
            New from brief
          </Button>
          <CreateProjectDialog />
        </div>
      </div>
      {briefOpen && <BriefDialog onClose={() => setBriefOpen(false)} />}

      {legacyCount !== undefined && legacyCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{legacyCount} project
            {legacyCount === 1 ? "" : "s"}</span> still store the old pipeline status. They already
            display as Not booked, Pencilled or Confirmed — this writes that across for good.
          </p>
          <Button size="sm" variant="secondary" onClick={handleMigrate} disabled={migrating}>
            {migrating ? "Updating…" : "Update them"}
          </Button>
        </div>
      )}

      <div className="mt-6">
        {sorted === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {showArchived ? "Nothing archived yet." : "No projects yet. Create your first one."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                <SortableHead label="Client" sortKey="client" sort={sort} onSort={toggle} />
                <SortableHead label="Shoot date" sortKey="date" sort={sort} onSort={toggle} />
                <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggle} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => {
                const date = rowDate(p);
                const isPast = p.nextShootDate === null && p.lastShootDate !== null;
                return (
                  <TableRow
                    key={p._id}
                    onClick={() => router.push(`/projects/${p._id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      {/* Kept as a real link so the row is reachable by keyboard */}
                      <Link
                        href={`/projects/${p._id}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.clientName ?? "\u00b7"}</TableCell>
                    <TableCell
                      className={cn("tabular-nums", (isPast || date === null) && "text-muted-foreground")}
                    >
                      {date === null ? (
                        "\u00b7"
                      ) : (
                        <>
                          {formatShootDate(date)}
                          {p.shootDayCount > 1 && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {"\u00b7"} {p.shootDayCount} days
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusBadgeClass(p.status)}>
                        {statusLabel(p.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived
              ? "← Back to active projects"
              : `View archived${archived !== undefined && archived.length > 0 ? ` (${archived.length})` : ""}`}
          </Button>
        </div>
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
