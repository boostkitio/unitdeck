"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { type EquipmentSection as SectionKey } from "../../../convex/projectEquipment";
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
import Link from "next/link";

// The query fills the section in for older rows, so it is always present here.
type EquipmentRow = Omit<Doc<"projectEquipment">, "section"> & { section: SectionKey };

type EquipmentSortKey = "dept" | "item" | "quantity" | "status" | "notes";

function equipmentSortValue(row: EquipmentRow, key: EquipmentSortKey): string | number | null {
  switch (key) {
    case "dept":
      return row.dept ?? null;
    case "item":
      return row.item;
    case "quantity":
      return row.quantity ?? null;
    case "status":
      // Still-needed first when ascending, which is the order that matters.
      return row.status === "confirmed" ? 1 : 0;
    case "notes":
      return row.notes ?? null;
  }
}

/**
 * A project's kit in two lists: the standard equipment going out, and whatever
 * is hired in on top. They are one table with one set of behaviours — only the
 * heading, the empty state and the buttons differ.
 */
export function EquipmentSection({ projectId }: { projectId: Id<"projects"> }) {
  const equipment = useQuery(api.projectEquipment.listForProject, { projectId });

  const [applying, setApplying] = useState(false);
  const [adding, setAdding] = useState<SectionKey | null>(null);
  const [editing, setEditing] = useState<EquipmentRow | null>(null);

  const rows = equipment as EquipmentRow[] | undefined;
  const standard = useMemo(
    () => (rows ?? []).filter((row) => row.section === "equipment"),
    [rows],
  );
  const additional = useMemo(
    () => (rows ?? []).filter((row) => row.section === "additional"),
    [rows],
  );

  return (
    <div className="mt-12 space-y-6">
      <EquipmentList
        title="Equipment"
        rows={standard}
        loading={rows === undefined}
        empty="Nothing listed. Add a package, or list the kit going out on this job."
        onEdit={setEditing}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setApplying(true)}>
              Add from package
            </Button>
            <Button size="sm" onClick={() => setAdding("equipment")}>
              Add equipment
            </Button>
          </>
        }
      />

      <EquipmentList
        title="Additional equipment"
        rows={additional}
        loading={rows === undefined}
        empty="Nothing extra. Anything hired in, or off a normal job, goes here."
        onEdit={setEditing}
        actions={
          <Button size="sm" onClick={() => setAdding("additional")}>
            Add equipment
          </Button>
        }
      />

      {applying && (
        <ApplyPackageDialog projectId={projectId} onClose={() => setApplying(false)} />
      )}
      {adding && (
        <EquipmentDialog
          projectId={projectId}
          section={adding}
          onClose={() => setAdding(null)}
        />
      )}
      {editing && (
        <EquipmentDialog
          projectId={projectId}
          section={editing.section}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EquipmentList({
  title,
  rows,
  loading,
  empty,
  actions,
  onEdit,
}: {
  title: string;
  rows: EquipmentRow[];
  loading: boolean;
  empty: string;
  actions: React.ReactNode;
  onEdit: (row: EquipmentRow) => void;
}) {
  const update = useMutation(api.projectEquipment.update);
  const remove = useMutation(api.projectEquipment.remove);

  const { sort, toggle } = useTableSort<EquipmentSortKey>({ key: "item", dir: "asc" });
  const sorted = useMemo(() => sortRows(rows, sort, equipmentSortValue), [rows, sort]);
  const outstanding = rows.filter((row) => row.status === "needed").length;

  async function toggleStatus(row: EquipmentRow) {
    try {
      await update({
        id: row._id,
        status: row.status === "needed" ? "confirmed" : "needed",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update it.");
    }
  }

  async function handleRemove(row: EquipmentRow) {
    try {
      await remove({ id: row._id });
      toast.success(`${row.item} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove it.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">{actions}</div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    label="Dept"
                    sortKey="dept"
                    sort={sort}
                    onSort={toggle}
                    className="w-32"
                  />
                  <SortableHead label="Item" sortKey="item" sort={sort} onSort={toggle} />
                  <SortableHead
                    label="Qty"
                    sortKey="quantity"
                    sort={sort}
                    onSort={toggle}
                    className="w-20 text-right"
                  />
                  <SortableHead
                    label="Status"
                    sortKey="status"
                    sort={sort}
                    onSort={toggle}
                    className="w-32"
                  />
                  <SortableHead label="Notes" sortKey="notes" sort={sort} onSort={toggle} />
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="truncate text-muted-foreground">
                      {row.dept ?? "·"}
                    </TableCell>
                    <TableCell className="font-medium">{row.item}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.quantity ?? "·"}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => void toggleStatus(row)}
                        title="Click to change"
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                          row.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
                        )}
                      >
                        {row.status === "confirmed" ? "Confirmed" : "Needed"}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {row.notes ?? ""}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleRemove(row)}>
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {outstanding > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {outstanding} item{outstanding === 1 ? "" : "s"} still to confirm. Click a status
                to change it.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentDialog({
  projectId,
  section,
  row,
  onClose,
}: {
  projectId: Id<"projects">;
  section: SectionKey;
  row?: EquipmentRow;
  onClose: () => void;
}) {
  const add = useMutation(api.projectEquipment.add);
  const update = useMutation(api.projectEquipment.update);

  const [item, setItem] = useState(row?.item ?? "");
  const [dept, setDept] = useState(row?.dept ?? "");
  const [quantity, setQuantity] = useState(row?.quantity !== undefined ? String(row.quantity) : "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [list, setList] = useState<SectionKey>(section);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (item.trim().length === 0) {
      toast.error("Name the equipment.");
      return;
    }
    const trimmedQuantity = quantity.trim();
    const parsedQuantity = trimmedQuantity === "" ? null : Number(trimmedQuantity);
    if (parsedQuantity !== null && (!Number.isFinite(parsedQuantity) || parsedQuantity < 1)) {
      toast.error("Quantity must be a whole number of at least 1.");
      return;
    }

    setSaving(true);
    try {
      if (row) {
        await update({
          id: row._id,
          item,
          dept: dept.trim() || null,
          quantity: parsedQuantity,
          notes: notes.trim() || null,
          section: list,
        });
        toast.success("Saved.");
      } else {
        await add({
          projectId,
          item,
          dept: dept.trim() || undefined,
          quantity: parsedQuantity ?? undefined,
          notes: notes.trim() || undefined,
          section: list,
        });
        toast.success("Equipment added.");
      }
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
          <DialogTitle>{row ? "Edit equipment" : "Add equipment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="equipment-item">Item</Label>
            <Input
              id="equipment-item"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="Ronin gimbal, 2x 1.2k HMI, walkie set…"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment-dept">Department (optional)</Label>
            <Input
              id="equipment-dept"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              placeholder="Camera, Lighting, Sound, Grip…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment-qty">Quantity (optional)</Label>
            <Input
              id="equipment-qty"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-32"
            />
          </div>
          {/* Which list it sits in, so a line put in the wrong one — or an
              older line from before the split — can be moved. */}
          <div className="space-y-2">
            <Label>List</Label>
            <div className="flex gap-2">
              <Button
                variant={list === "equipment" ? "default" : "outline"}
                size="sm"
                onClick={() => setList("equipment")}
              >
                Equipment
              </Button>
              <Button
                variant={list === "additional" ? "default" : "outline"}
                size="sm"
                onClick={() => setList("additional")}
              >
                Additional
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Additional is for kit hired in, or anything off a normal job.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="equipment-notes">Notes (optional)</Label>
            <Textarea
              id="equipment-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Hire from…, needed for day 2 only…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : row ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyPackageDialog({
  projectId,
  onClose,
}: {
  projectId: Id<"projects">;
  onClose: () => void;
}) {
  const packages = useQuery(api.equipmentPackages.list, {});
  const applyToProject = useMutation(api.equipmentPackages.applyToProject);
  const [busy, setBusy] = useState(false);

  async function apply(packageId: Id<"equipmentPackages">) {
    setBusy(true);
    try {
      const result = await applyToProject({ packageId, projectId });
      toast.success(
        `Added ${result.added} item${result.added === 1 ? "" : "s"} from ${result.packageName}.`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the package.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-full max-w-lg overflow-y-auto sm:p-5">
        <DialogHeader>
          <DialogTitle>Add a package</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {packages === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : packages.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No packages yet. Build one on the{" "}
              <Link href="/equipment" className="underline underline-offset-2 text-foreground">
                Equipment
              </Link>{" "}
              tab and it will show up here.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {packages.map((pkg) => (
                <li key={pkg._id}>
                  <button
                    type="button"
                    disabled={busy || pkg.items.length === 0}
                    onClick={() => void apply(pkg._id)}
                    className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    <span className="truncate text-sm font-medium">{pkg.name}</span>
                    <span className="block w-full truncate text-xs text-muted-foreground">
                      {pkg.items.length === 0
                        ? "Empty — nothing to add"
                        : pkg.items.map((i) => i.item).join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
