"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CsvImportDialog, type CsvColumnSpec } from "@/components/csv-import-dialog";
import { SearchInput } from "@/components/search-input";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { matchesSearch } from "@/lib/search";
import { PackagesView } from "@/components/equipment/packages-view";

type EquipmentSortKey =
  | "dept"
  | "item"
  | "serialNumber"
  | "weightKg"
  | "valueNew"
  | "valueCurrent"
  | "countryOfManufacture";

function equipmentSortValue(
  row: Doc<"equipment">,
  key: EquipmentSortKey,
): string | number | null {
  switch (key) {
    case "dept":
      return row.dept ?? null;
    case "item":
      return row.item;
    case "serialNumber":
      return row.serialNumber ?? null;
    case "weightKg":
      return row.weightKg ?? null;
    case "valueNew":
      return row.valueNew ?? null;
    case "valueCurrent":
      return row.valueCurrent ?? null;
    case "countryOfManufacture":
      return row.countryOfManufacture ?? null;
  }
}

const IMPORT_COLUMNS: CsvColumnSpec[] = [
  { key: "dept", label: "Dept", aliases: ["Department", "Category"] },
  { key: "item", label: "Item", aliases: ["Equipment", "Name", "Description"], required: true },
  { key: "serialNumber", label: "Serial number", aliases: ["Serial", "Serial No", "SN"] },
  { key: "weightKg", label: "Weight (kg)", aliases: ["Weight", "Kg", "Mass"] },
  { key: "valueNew", label: "Value when new", aliases: ["New Value", "Purchase Price", "RRP"] },
  { key: "valueCurrent", label: "Current value", aliases: ["Value", "Present Value"] },
  {
    key: "countryOfManufacture",
    label: "Country of manufacture",
    aliases: ["Country", "Made In", "Origin"],
  },
];

/** Strips currency symbols and thousands separators before parsing. */
function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (cleaned.length === 0) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function money(value: number | undefined): string {
  if (value === undefined) return "·";
  return `£${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

type EquipmentForm = {
  dept: string;
  item: string;
  serialNumber: string;
  weightKg: string;
  valueNew: string;
  valueCurrent: string;
  countryOfManufacture: string;
  notes: string;
};

const EMPTY_FORM: EquipmentForm = {
  dept: "",
  item: "",
  serialNumber: "",
  weightKg: "",
  valueNew: "",
  valueCurrent: "",
  countryOfManufacture: "",
  notes: "",
};

export default function EquipmentPage() {
  const { organization } = useOrganization();
  const equipment = useQuery(api.equipment.list, organization ? {} : "skip");
  const createEquipment = useMutation(api.equipment.create);
  const updateEquipment = useMutation(api.equipment.update);
  const removeEquipment = useMutation(api.equipment.remove);
  const importRows = useMutation(api.equipment.importRows);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"equipment"> | null>(null);
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"items" | "packages">("items");
  const { sort, toggle } = useTableSort<EquipmentSortKey>({ key: "item", dir: "asc" });

  const visible = useMemo(
    () =>
      sortRows(
        (equipment ?? []).filter((row) =>
          matchesSearch(search, [
            row.dept,
            row.item,
            row.serialNumber,
            row.countryOfManufacture,
            row.notes,
          ]),
        ),
        sort,
        equipmentSortValue,
      ),
    [equipment, search, sort],
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(row: Doc<"equipment">) {
    setEditing(row);
    setForm({
      dept: row.dept ?? "",
      item: row.item,
      serialNumber: row.serialNumber ?? "",
      weightKg: row.weightKg !== undefined ? String(row.weightKg) : "",
      valueNew: row.valueNew !== undefined ? String(row.valueNew) : "",
      valueCurrent: row.valueCurrent !== undefined ? String(row.valueCurrent) : "",
      countryOfManufacture: row.countryOfManufacture ?? "",
      notes: row.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (form.item.trim() === "") {
      toast.error("Name the item.");
      return;
    }
    const weightKg = parseNumber(form.weightKg);
    const valueNew = parseNumber(form.valueNew);
    const valueCurrent = parseNumber(form.valueCurrent);

    setSaving(true);
    try {
      if (editing) {
        await updateEquipment({
          id: editing._id,
          item: form.item,
          dept: form.dept.trim() || null,
          serialNumber: form.serialNumber.trim() || null,
          weightKg: weightKg ?? null,
          valueNew: valueNew ?? null,
          valueCurrent: valueCurrent ?? null,
          countryOfManufacture: form.countryOfManufacture.trim() || null,
          notes: form.notes.trim() || null,
        });
        toast.success("Saved.");
      } else {
        await createEquipment({
          item: form.item,
          dept: form.dept.trim() || undefined,
          serialNumber: form.serialNumber.trim() || undefined,
          weightKg,
          valueNew,
          valueCurrent,
          countryOfManufacture: form.countryOfManufacture.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
        toast.success("Equipment added.");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: Id<"equipment">) {
    try {
      await removeEquipment({ id });
      toast.success("Equipment removed.");
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove it.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Equipment</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "packages"
              ? "Bundles of kit you can drop onto a project in one go."
              : "Your kit, department by department."}
          </p>
        </div>
        {view === "items" && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button onClick={openCreate}>Add equipment</Button>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2 border-b border-border pb-3">
        <Button
          size="sm"
          variant={view === "items" ? "secondary" : "ghost"}
          onClick={() => setView("items")}
        >
          Items
        </Button>
        <Button
          size="sm"
          variant={view === "packages" ? "secondary" : "ghost"}
          onClick={() => setView("packages")}
        >
          Packages
        </Button>
      </div>

      {view === "packages" ? (
        <div className="mt-6">
          <PackagesView />
        </div>
      ) : (
      <div className="mt-6">
        {equipment !== undefined && equipment.length > 0 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search dept, item, serial, country or notes…"
            className="mb-4 max-w-sm"
          />
        )}
        {equipment === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : equipment.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No equipment yet. Add a piece of kit, or import your inventory from a CSV.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No equipment matches “{search}”.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Dept" sortKey="dept" sort={sort} onSort={toggle} />
                <SortableHead label="Item" sortKey="item" sort={sort} onSort={toggle} />
                <SortableHead
                  label="Serial number"
                  sortKey="serialNumber"
                  sort={sort}
                  onSort={toggle}
                />
                <SortableHead
                  label="Weight (kg)"
                  sortKey="weightKg"
                  sort={sort}
                  onSort={toggle}
                  className="text-right"
                />
                <SortableHead
                  label="Value when new"
                  sortKey="valueNew"
                  sort={sort}
                  onSort={toggle}
                  className="text-right"
                />
                <SortableHead
                  label="Current value"
                  sortKey="valueCurrent"
                  sort={sort}
                  onSort={toggle}
                  className="text-right"
                />
                <SortableHead
                  label="Country of manufacture"
                  sortKey="countryOfManufacture"
                  sort={sort}
                  onSort={toggle}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row._id} className="cursor-pointer" onClick={() => openEdit(row)}>
                  <TableCell className="text-muted-foreground">{row.dept ?? "·"}</TableCell>
                  <TableCell className="font-medium">{row.item}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.serialNumber ?? "·"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.weightKg !== undefined ? row.weightKg : "·"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {money(row.valueNew)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {money(row.valueCurrent)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.countryOfManufacture ?? "·"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      )}

      {importOpen && (
        <CsvImportDialog
          title="Import equipment from CSV"
          description="Every row becomes a piece of kit. Rows are matched on serial number, so re-importing a corrected file updates rather than duplicates. Rows without a serial always add, since there is nothing to match them on."
          columns={IMPORT_COLUMNS}
          exampleHeader="Dept,Item,Serial number,Weight (kg),Value when new,Current value,Country of manufacture"
          onImportBatch={(rows) =>
            importRows({
              rows: rows.map((row) => ({
                item: row.item ?? "",
                dept: row.dept,
                serialNumber: row.serialNumber,
                weightKg: parseNumber(row.weightKg),
                valueNew: parseNumber(row.valueNew),
                valueCurrent: parseNumber(row.valueCurrent),
                countryOfManufacture: row.countryOfManufacture,
              })),
            })
          }
          onClose={() => setImportOpen(false)}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] w-full max-w-xl overflow-y-auto sm:p-5">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit equipment" : "Add equipment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eq-dept">Dept</Label>
                <Input
                  id="eq-dept"
                  value={form.dept}
                  onChange={(e) => setForm({ ...form, dept: e.target.value })}
                  placeholder="Camera, Lighting, Sound…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-item">Item</Label>
                <Input
                  id="eq-item"
                  value={form.item}
                  onChange={(e) => setForm({ ...form, item: e.target.value })}
                  placeholder="Sony FX9"
                  autoFocus
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eq-serial">Serial number</Label>
                <Input
                  id="eq-serial"
                  value={form.serialNumber}
                  onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-weight">Weight (kg)</Label>
                <Input
                  id="eq-weight"
                  inputMode="decimal"
                  value={form.weightKg}
                  onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eq-value-new">Value when new</Label>
                <Input
                  id="eq-value-new"
                  inputMode="decimal"
                  value={form.valueNew}
                  onChange={(e) => setForm({ ...form, valueNew: e.target.value })}
                  placeholder="£"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-value-current">Current value</Label>
                <Input
                  id="eq-value-current"
                  inputMode="decimal"
                  value={form.valueCurrent}
                  onChange={(e) => setForm({ ...form, valueCurrent: e.target.value })}
                  placeholder="£"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eq-country">Country of manufacture</Label>
              <Input
                id="eq-country"
                value={form.countryOfManufacture}
                onChange={(e) => setForm({ ...form, countryOfManufacture: e.target.value })}
                placeholder="Japan"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="eq-notes">Notes</Label>
              <Textarea
                id="eq-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            {editing ? (
              <Button variant="ghost" onClick={() => void handleRemove(editing._id)}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
