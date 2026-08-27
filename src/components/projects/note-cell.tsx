"use client";

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useSyncedField } from "@/lib/use-debounced-save";

/**
 * A note about one person on one production, edited where it is read.
 *
 * The same cell serves crew, talent and client because the note means the
 * same thing in all three: what this person is doing on this job, which is
 * not a fact about them anywhere else.
 *
 * It saves a beat after typing stops and follows the stored value the rest of
 * the time, so a note written by whoever else has the project open appears
 * here rather than being overwritten.
 */
export function NoteCell({
  value,
  placeholder = "Add a note",
  onSave,
}: {
  value: string | null;
  placeholder?: string;
  onSave: (notes: string) => Promise<void>;
}) {
  const { value: text, setValue } = useSyncedField(value ?? "", async (next) => {
    try {
      await onSave(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the note.");
    }
  });

  return (
    <Input
      value={text}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      aria-label="Note for this project"
      // Reads as text until you go for it, so a column of empty notes does
      // not look like a column of empty boxes.
      className="h-8 border-transparent bg-transparent px-1.5 text-sm shadow-none hover:border-border focus-visible:border-ring"
    />
  );
}
