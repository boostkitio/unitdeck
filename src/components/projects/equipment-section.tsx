"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  type EquipmentClash,
  type EquipmentSection as SectionKey,
} from "../../../convex/projectEquipment";
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
import { matchesSearch } from "@/lib/search";
import { formatShootDate } from "@/lib/format-date";
import { PROJECT_STATUSES } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import Link from "next/link";

// The query fills the section in for older rows, so it is always present here.
type EquipmentRow = Omit<Doc<"projectEquipment">, "section"> & { section: SectionKey };

type EquipmentSortKey = "dept" | "item" | "quantity" | "cost" | "status" | "notes";

function equipmentSortValue(row: EquipmentRow, key: EquipmentSortKey): string | number | null {
  switch (key) {
    case "dept":
      return row.dept ?? null;
    case "item":
      return row.item;
    case "quantity":
      return row.quantity ?? null;
    case "cost":
      return row.cost ?? null;
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
  const clashes = useQuery(api.projectEquipment.clashesForProject, { projectId });

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
      {clashes && clashes.length > 0 && <ClashWarning clashes={clashes} />}

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
          taken={(rows ?? []).map((row) => row.equipmentId)}
          clashes={clashes ?? []}
          onClose={() => setAdding(null)}
        />
      )}
      {editing && (
        <EquipmentDialog
          projectId={projectId}
          section={editing.section}
          row={editing}
          taken={(rows ?? []).map((row) => row.equipmentId)}
          clashes={clashes ?? []}
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
  // Only lines that carry a cost contribute; kit you own usually has none.
  const total = rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);

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
                    label="Cost"
                    sortKey="cost"
                    sort={sort}
                    onSort={toggle}
                    className="w-24 text-right"
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
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.cost !== undefined ? `£${row.cost.toLocaleString("en-GB")}` : "·"}
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
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {outstanding > 0 &&
                  `${outstanding} item${outstanding === 1 ? "" : "s"} still to confirm. Click a status to change it.`}
              </p>
              {total > 0 && (
                <p className="text-xs text-muted-foreground">
                  Total{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    £{total.toLocaleString("en-GB")}
                  </span>
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What this production wants that it cannot have, because the productions
 * shooting the same day want more of it than the company owns.
 *
 * Says the numbers, because "clash" on its own is not actionable: three
 * wanted, two owned tells you what to hire. "Remove" takes this production's
 * lines off — nothing is touched on the other production, since which shoot
 * gives way is a decision rather than something to guess.
 */
function ClashWarning({ clashes }: { clashes: EquipmentClash[] }) {
  const removeMany = useMutation(api.projectEquipment.removeMany);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  if (clashes.length === 0) return null;

  async function remove(ids: Id<"projectEquipment">[]) {
    setBusy(true);
    try {
      const result = await removeMany({ ids });
      toast.success(
        `${result.removed} line${result.removed === 1 ? "" : "s"} removed from this project.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove them.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          <span className="font-medium">{clashes.length}</span>{" "}
          {clashes.length === 1 ? "item is" : "items are"} overbooked — more is wanted on the
          day than you own.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void remove(clashes.flatMap((c) => c.rowIds))}
          >
            Remove {clashes.length === 1 ? "it" : `all ${clashes.length}`}
          </Button>
        </div>
      </div>

      {open && (
        <ul className="mt-3 space-y-2">
          {clashes.map((clash) => (
            <li
              key={clash.key}
              className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-border bg-background p-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {clash.item}{" "}
                  <span className="font-normal text-muted-foreground">
                    — you own {clash.stock}, {clash.mine} wanted here
                  </span>
                </span>
                {clash.others.map((other) => (
                  <span
                    key={other.projectId}
                    className="block truncate text-xs text-muted-foreground"
                  >
                    {other.count} on {other.projectName} ({statusLabel(other.status)}) ·{" "}
                    {other.dates.map(formatShootDate).join(", ")}
                  </span>
                ))}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove(clash.rowIds)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The booking status of the other production, in the words the app uses. */
function statusLabel(status: string): string {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/**
 * Searchable list of the org's kit, minus what is already on this production.
 * Adding a piece you own should be a search and a click, the same as booking a
 * crew member — typing its name again invites typos and loses the department.
 */
function EquipmentPicker({
  taken,
  clashes,
  disabled,
  onPick,
}: {
  taken: (Id<"equipment"> | undefined)[];
  /** Kit another production wants on one of these shoot days. */
  clashes: EquipmentClash[];
  disabled: boolean;
  onPick: (equipmentId: Id<"equipment">) => void;
}) {
  const equipment = useQuery(api.equipment.list, {});
  const [search, setSearch] = useState("");

  const used = useMemo(
    () => new Set(taken.filter((id): id is Id<"equipment"> => id !== undefined).map(String)),
    [taken],
  );
  const available = useMemo(
    () => (equipment ?? []).filter((row) => !used.has(row._id)),
    [equipment, used],
  );
  const matches = useMemo(
    () =>
      available.filter((row) => matchesSearch(search, [row.dept, row.item, row.serialNumber])),
    [available, search],
  );

  // Said before the click rather than after: adding it is still allowed, but
  // you should know it is spoken for.
  const clashByItem = useMemo(
    () => new Map(clashes.map((clash) => [clash.key, clash])),
    [clashes],
  );

  if (equipment === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search by item, department or serial number…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {matches.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {equipment.length === 0 ? (
            <>
              Your{" "}
              <Link href="/equipment" className="underline underline-offset-2 text-foreground">
                equipment
              </Link>{" "}
              list is empty.
            </>
          ) : available.length === 0 ? (
            "Everything in your equipment list is already on this project."
          ) : (
            "Nothing matches that search."
          )}
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {matches.map((row) => (
            <li key={row._id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(row._id)}
                className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{row.item}</span>
                  <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                    {row.dept ?? ""}
                  </span>
                </span>
                <span className="block w-full truncate text-xs text-muted-foreground">
                  {row.serialNumber ? `Serial ${row.serialNumber}` : "No serial number"}
                </span>
                {clashByItem.get(row.item.trim().toLowerCase().replace(/\s+/g, " ")) && (
                  <span className="block w-full truncate text-xs text-amber-700 dark:text-amber-400">
                    Already overbooked on this day
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EquipmentDialog({
  projectId,
  section,
  row,
  taken,
  clashes,
  onClose,
}: {
  projectId: Id<"projects">;
  section: SectionKey;
  row?: EquipmentRow;
  /** Inventory already on this project, so the picker does not offer it twice. */
  taken: (Id<"equipment"> | undefined)[];
  clashes: EquipmentClash[];
  onClose: () => void;
}) {
  const add = useMutation(api.projectEquipment.add);
  const update = useMutation(api.projectEquipment.update);

  // Kit you own is picked from the list; the hire-in list is typed, so each
  // section opens on the way its kit usually arrives.
  const [mode, setMode] = useState<"pick" | "type">(
    section === "equipment" ? "pick" : "type",
  );
  const [added, setAdded] = useState(0);

  const [item, setItem] = useState(row?.item ?? "");
  const [dept, setDept] = useState(row?.dept ?? "");
  const [quantity, setQuantity] = useState(row?.quantity !== undefined ? String(row.quantity) : "");
  const [cost, setCost] = useState(row?.cost !== undefined ? String(row.cost) : "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [list, setList] = useState<SectionKey>(section);
  const [saving, setSaving] = useState(false);

  /** Adds a piece of kit and stays open, since kit is listed in handfuls. */
  async function pick(equipmentId: Id<"equipment">) {
    setSaving(true);
    try {
      await add({ projectId, equipmentId, section: list });
      setAdded((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setSaving(false);
    }
  }

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

    const trimmedCost = cost.trim().replace(/[£,]/g, "");
    const parsedCost = trimmedCost === "" ? null : Number(trimmedCost);
    if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      toast.error("Cost must be a number of zero or more.");
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
          cost: parsedCost,
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
          cost: parsedCost ?? undefined,
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

        {!row && (
          <div className="flex flex-wrap gap-2 border-b border-border pb-3">
            <Button
              size="sm"
              variant={mode === "pick" ? "secondary" : "ghost"}
              onClick={() => setMode("pick")}
            >
              From your equipment
            </Button>
            <Button
              size="sm"
              variant={mode === "type" ? "secondary" : "ghost"}
              onClick={() => setMode("type")}
            >
              Something you hire in
            </Button>
          </div>
        )}

        {!row && mode === "pick" ? (
          <div className="py-2">
            <EquipmentPicker
              taken={taken}
              clashes={clashes}
              disabled={saving}
              onPick={(id) => void pick(id)}
            />
          </div>
        ) : (
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
          <div className="flex gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="equipment-cost">Cost (optional)</Label>
              <Input
                id="equipment-cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="£"
                className="w-32"
              />
            </div>
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
        )}

        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {added > 0 && `${added} added`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {added > 0 ? "Done" : "Cancel"}
            </Button>
            {(row || mode === "type") && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : row ? "Save" : "Add"}
              </Button>
            )}
          </div>
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
