"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";
const ADD_NEW = "__add_new__";

/**
 * The department a piece of kit is filed under, picked from a list.
 *
 * Typed by hand, "Lighting", "lighting" and "Lights" end up as three
 * departments on one kit list. A list keeps them one — but a job always turns
 * up something the list has not got, so a new department can be added from
 * here and is offered everywhere after.
 */
export function DepartmentSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const departments = useQuery(api.equipment.departments, {});
  const addDepartment = useMutation(api.equipment.addDepartment);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // A department set before the list existed stays choosable, even while the
  // list is still loading.
  const options = [...(departments ?? [])];
  if (value.trim() && !options.some((o) => o.toLowerCase() === value.trim().toLowerCase())) {
    options.unshift(value.trim());
  }

  async function save() {
    if (draft.trim().length === 0) {
      toast.error("Name the department.");
      return;
    }
    setSaving(true);
    try {
      const name = await addDepartment({ name: draft });
      onChange(name);
      setDraft("");
      setAdding(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the department.");
    } finally {
      setSaving(false);
    }
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New department, e.g. Drones"
          aria-label="New department"
          autoFocus
          disabled={saving || disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setAdding(false);
            }
          }}
        />
        <Button size="sm" onClick={() => void save()} disabled={saving || disabled}>
          {saving ? "Adding…" : "Add"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value.trim() ? options.find((o) => o.toLowerCase() === value.trim().toLowerCase()) : NONE}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === ADD_NEW) {
          setDraft("");
          setAdding(true);
          return;
        }
        onChange(next === NONE || next === null ? "" : next);
      }}
    >
      <SelectTrigger id={id} className="w-full">
        {/* Explicit label: Base UI shows the raw value when items mount late */}
        <SelectValue>{value.trim() || "No department"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No department</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
        <SelectItem value={ADD_NEW}>+ Add a new category…</SelectItem>
      </SelectContent>
    </Select>
  );
}
