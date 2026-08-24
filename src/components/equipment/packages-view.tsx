"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { type EquipmentPackage } from "../../../convex/equipmentPackages";
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
import { Skeleton } from "@/components/ui/skeleton";
import { matchesSearch } from "@/lib/search";
import { saveStateLabel, useDebouncedSave } from "@/lib/use-debounced-save";

export function PackagesView() {
  const packages = useQuery(api.equipmentPackages.list, {});
  const removePackage = useMutation(api.equipmentPackages.remove);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<Id<"equipmentPackages"> | null>(null);

  // Resolve from the query rather than holding a snapshot, so the editor shows
  // items as they are added instead of the list as it was when opened.
  const open = useMemo(
    () => (packages ?? []).find((p) => p._id === editingId) ?? null,
    [packages, editingId],
  );

  async function handleRemove(pkg: EquipmentPackage) {
    try {
      await removePackage({ id: pkg._id });
      toast.success(`${pkg.name} deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete it.");
    }
  }

  return (
    <div>
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>New package</Button>
      </div>

      {packages === undefined ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : packages.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No packages yet. Group the kit you always take out together, then drop the whole
          package onto a project in one go.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {packages.map((pkg) => (
            <Card key={pkg._id}>
              <CardHeader>
                <CardTitle>{pkg.name}</CardTitle>
                <CardAction>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(pkg._id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleRemove(pkg)}>
                      Delete
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {pkg.notes && <p className="mb-2 text-xs text-muted-foreground">{pkg.notes}</p>}
                {pkg.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing in it yet.</p>
                ) : (
                  <>
                    <p className="mb-1 text-xs text-muted-foreground">
                      {pkg.items.length} item{pkg.items.length === 1 ? "" : "s"}
                    </p>
                    <ul className="space-y-0.5 text-sm">
                      {pkg.items.slice(0, 6).map((item) => (
                        <li key={item._id} className="truncate text-muted-foreground">
                          {item.quantity ? `${item.quantity} × ` : ""}
                          {item.item}
                        </li>
                      ))}
                      {pkg.items.length > 6 && (
                        <li className="text-xs text-muted-foreground">
                          … and {pkg.items.length - 6} more
                        </li>
                      )}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && <NewPackageDialog onClose={() => setCreating(false)} />}
      {open && <PackageEditor pkg={open} onClose={() => setEditingId(null)} />}
    </div>
  );
}

function NewPackageDialog({ onClose }: { onClose: () => void }) {
  const create = useMutation(api.equipmentPackages.create);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (name.trim().length === 0) {
      toast.error("Name the package.");
      return;
    }
    setSaving(true);
    try {
      await create({ name, notes: notes.trim() || undefined });
      toast.success("Package created. Add the kit that goes in it.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create it.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New package</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pkg-name">Name</Label>
            <Input
              id="pkg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Standard camera package"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pkg-notes">Notes (optional)</Label>
            <Textarea
              id="pkg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackageEditor({ pkg, onClose }: { pkg: EquipmentPackage; onClose: () => void }) {
  const equipment = useQuery(api.equipment.list, {});
  const addItem = useMutation(api.equipmentPackages.addItem);
  const removeItem = useMutation(api.equipmentPackages.removeItem);
  const updatePackage = useMutation(api.equipmentPackages.update);
  const createEquipment = useMutation(api.equipment.create);

  const [name, setName] = useState(pkg.name);
  const [search, setSearch] = useState("");
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);

  // New inventory item, created here and dropped straight into the package.
  const [addingNew, setAddingNew] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newSerial, setNewSerial] = useState("");

  const saveName = useCallback(
    async (value: string) => {
      await updatePackage({ id: pkg._id, name: value });
    },
    [updatePackage, pkg._id],
  );

  // A blank name is rejected server-side, so hold the stored value until there
  // is something worth saving rather than firing a doomed request per keypress.
  const nameToSave = name.trim().length === 0 ? pkg.name : name;
  const nameState = useDebouncedSave(nameToSave, pkg.name, saveName);
  const nameStatus = saveStateLabel(nameState);

  const inPackage = useMemo(
    () =>
      new Set(
        pkg.items
          .map((i) => (i.equipmentId ? String(i.equipmentId) : null))
          .filter((id): id is string => id !== null),
      ),
    [pkg.items],
  );

  const matches = useMemo(
    () =>
      (equipment ?? [])
        .filter((row) => !inPackage.has(row._id))
        .filter((row) => matchesSearch(search, [row.dept, row.item, row.serialNumber])),
    [equipment, inPackage, search],
  );

  async function add(equipmentId?: Id<"equipment">, item?: string) {
    setBusy(true);
    try {
      await addItem({ packageId: pkg._id, equipmentId, item });
      if (item) setFreeText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Adds a piece of kit you own: it goes into the main equipment list as well
   * as this package, so it is there next time without a trip to the Items tab.
   */
  async function createAndAdd() {
    const item = newItem.trim();
    if (item.length === 0) {
      toast.error("Name the item.");
      return;
    }
    setBusy(true);
    try {
      const equipmentId = await createEquipment({
        item,
        dept: newDept.trim() || undefined,
        serialNumber: newSerial.trim() || undefined,
      });
      await addItem({ packageId: pkg._id, equipmentId });
      toast.success(`${item} added to your equipment list and this package.`);
      setNewItem("");
      setNewDept("");
      setNewSerial("");
      setAddingNew(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      {/* A two-column working view, so it takes the screen: kit names are long
          and two lists side by side need the room. Each column scrolls on its
          own so the dialog itself stays put. */}
      <DialogContent className="grid-rows-[auto_1fr_auto] h-[90vh] w-[96vw] max-w-[1800px] overflow-hidden sm:p-6">
        {/* The heading is the name field. pr-10 keeps it clear of the close button. */}
        <DialogHeader className="pr-10">
          <DialogTitle className="sr-only">{pkg.name}</DialogTitle>
          <label htmlFor="pkg-editor-name" className="sr-only">
            Package name
          </label>
          <div className="flex min-w-0 items-center gap-3">
            <input
              id="pkg-editor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled package"
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-heading text-xl font-semibold tracking-tight outline-none transition-colors hover:border-border focus:border-border focus:bg-background"
            />
            {nameStatus && (
              <span className="shrink-0 text-xs text-muted-foreground">{nameStatus}</span>
            )}
          </div>
        </DialogHeader>

        <div className="grid min-h-0 gap-6 overflow-hidden py-2 md:grid-cols-2">
          <div className="flex min-h-0 flex-col space-y-2">
            <Label>In this package</Label>
            {pkg.items.length === 0 ? (
              <p className="flex-1 rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing in it yet.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {pkg.items.map((item) => (
                  <li
                    key={item._id}
                    className="flex min-w-0 items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {item.quantity ? `${item.quantity} × ` : ""}
                      {item.item}
                      {item.equipmentId === null && (
                        <span className="ml-1.5 text-xs text-muted-foreground">(hired in)</span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void removeItem({ id: item._id })}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex min-h-0 flex-col space-y-2">
            <Label htmlFor="pkg-search">Add from your equipment</Label>
            <Input
              id="pkg-search"
              placeholder="Search your kit…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {equipment === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : matches.length === 0 ? (
              <p className="rounded-md border border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {(equipment ?? []).length === 0
                  ? "Your equipment list is empty."
                  : "Everything matching is already in the package."}
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {matches.map((row) => (
                  <li key={row._id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void add(row._id)}
                      className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="truncate text-sm font-medium">{row.item}</span>
                      <span className="block w-full truncate text-xs text-muted-foreground">
                        {[row.dept, row.serialNumber].filter(Boolean).join(" · ") ||
                          "No dept or serial"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="shrink-0 space-y-3 pt-2">
              {addingNew ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="pkg-new-item">New piece of equipment</Label>
                    <span className="text-xs text-muted-foreground">
                      Goes on your equipment list too
                    </span>
                  </div>
                  <Input
                    id="pkg-new-item"
                    value={newItem}
                    onChange={(e) => setNewItem(e.target.value)}
                    placeholder="Sony FX6"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newItem.trim()) {
                        e.preventDefault();
                        void createAndAdd();
                      }
                    }}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={newDept}
                      onChange={(e) => setNewDept(e.target.value)}
                      placeholder="Dept (optional)"
                      aria-label="Department"
                    />
                    <Input
                      value={newSerial}
                      onChange={(e) => setNewSerial(e.target.value)}
                      placeholder="Serial number (optional)"
                      aria-label="Serial number"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setAddingNew(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || newItem.trim().length === 0}
                      onClick={() => void createAndAdd()}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
                  Add new equipment
                </Button>
              )}

              <div className="space-y-2">
                <Label htmlFor="pkg-free">Or add something you hire in</Label>
                <div className="flex gap-2">
                  <Input
                    id="pkg-free"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="2x 1.2k HMI"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && freeText.trim()) {
                        e.preventDefault();
                        void add(undefined, freeText);
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || freeText.trim().length === 0}
                    onClick={() => void add(undefined, freeText)}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
