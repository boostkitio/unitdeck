"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
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
import { cn } from "@/lib/utils";

type EquipmentRow = Doc<"projectEquipment">;

export function EquipmentSection({ projectId }: { projectId: Id<"projects"> }) {
  const equipment = useQuery(api.projectEquipment.listForProject, { projectId });
  const update = useMutation(api.projectEquipment.update);
  const remove = useMutation(api.projectEquipment.remove);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EquipmentRow | null>(null);

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

  const outstanding = (equipment ?? []).filter((row) => row.status === "needed").length;

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Additional equipment</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setAdding(true)}>
            Add equipment
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {equipment === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : equipment.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing listed. Add anything this production needs beyond the standard kit.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipment.map((row) => (
                  <TableRow key={row._id}>
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
                        <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
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

      {adding && <EquipmentDialog projectId={projectId} onClose={() => setAdding(false)} />}
      {editing && (
        <EquipmentDialog
          projectId={projectId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function EquipmentDialog({
  projectId,
  row,
  onClose,
}: {
  projectId: Id<"projects">;
  row?: EquipmentRow;
  onClose: () => void;
}) {
  const add = useMutation(api.projectEquipment.add);
  const update = useMutation(api.projectEquipment.update);

  const [item, setItem] = useState(row?.item ?? "");
  const [quantity, setQuantity] = useState(row?.quantity !== undefined ? String(row.quantity) : "");
  const [notes, setNotes] = useState(row?.notes ?? "");
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
          quantity: parsedQuantity,
          notes: notes.trim() || null,
        });
        toast.success("Saved.");
      } else {
        await add({
          projectId,
          item,
          quantity: parsedQuantity ?? undefined,
          notes: notes.trim() || undefined,
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
