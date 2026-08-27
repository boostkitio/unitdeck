"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSyncedField } from "@/lib/use-debounced-save";

/**
 * A text box two people can be in at once.
 *
 * It saves a beat after typing stops and shows the stored value the rest of
 * the time, so an edit made by whoever else has the page open appears here
 * instead of being masked — and then overwritten — by a stale box. This is the
 * same rule the production name and brief follow; the only thing wrong with an
 * uncontrolled `defaultValue` box is that it never learns.
 *
 * `onSave` must be stable, or the debounce timer restarts on every render and
 * nothing is ever written. Wrap it in useCallback at the caller.
 */
function useField(
  value: string,
  onSave: (next: string) => Promise<unknown>,
  failure: string,
  options: { canSave?: (value: string) => boolean } = {}
) {
  const save = useCallback(
    async (next: string) => {
      try {
        await onSave(next);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : failure);
      }
    },
    [onSave, failure]
  );
  return useSyncedField(value, save, options);
}

export function SyncedInput({
  value,
  onSave,
  failure = "Could not save it.",
  canSave,
  ...props
}: {
  value: string;
  onSave: (next: string) => Promise<unknown>;
  failure?: string;
  canSave?: (value: string) => boolean;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "defaultValue">) {
  const { value: text, setValue } = useField(value, onSave, failure, { canSave });
  return <Input {...props} value={text} onChange={(e) => setValue(e.target.value)} />;
}

export function SyncedTextarea({
  value,
  onSave,
  failure = "Could not save it.",
  canSave,
  ...props
}: {
  value: string;
  onSave: (next: string) => Promise<unknown>;
  failure?: string;
  canSave?: (value: string) => boolean;
} & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "defaultValue">) {
  const { value: text, setValue } = useField(value, onSave, failure, { canSave });
  return <Textarea {...props} value={text} onChange={(e) => setValue(e.target.value)} />;
}
