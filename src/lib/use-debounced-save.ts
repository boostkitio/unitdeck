"use client";

import { useCallback, useEffect, useState } from "react";
import { fieldValue, shouldSave, shouldSettle } from "./synced-field";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * A field that saves a beat after typing stops, and takes on changes made by
 * anyone else in the meantime.
 *
 * It owns the value rather than the caller holding its own copy in useState,
 * because that copy was the bug: it never learned about a change made
 * elsewhere, so it wrote its stale text back over it, and the other browser
 * did the same in return.
 *
 * `savedValue` is the stored value, live from the query. `save` must be
 * stable — wrap it in useCallback, or the timer restarts on every render and
 * nothing is ever written.
 */
export function useSyncedField(
  savedValue: string,
  save: (value: string) => Promise<void>,
  options: { delay?: number; canSave?: (value: string) => boolean } = {},
): { value: string; setValue: (next: string) => void; state: SaveState } {
  const { delay = 800, canSave } = options;
  // Null means "not editing" — the field shows whatever is stored. Only
  // typing creates a draft.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");

  useEffect(() => {
    if (!shouldSave(draft, savedValue, canSave)) return;
    const written = draft as string;
    const timer = setTimeout(() => {
      setState("saving");
      save(written)
        .then(() => {
          setState("saved");
          // Let go of the draft now the write has landed, so the field
          // follows the query again and shows what anyone else does next.
          // Unless more has been typed since — then that is still unsaved
          // and holding it is the point.
          setDraft((current) => (shouldSettle(current, written) ? null : current));
        })
        .catch(() => setState("error"));
    }, delay);
    return () => clearTimeout(timer);
  }, [draft, savedValue, save, delay, canSave]);

  const setValue = useCallback((next: string) => setDraft(next), []);

  return { value: fieldValue(draft, savedValue), setValue, state };
}

/** Short status text for a debounced field, or null when there is nothing to say. */
export function saveStateLabel(state: SaveState): string | null {
  switch (state) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Could not save";
    case "idle":
      return null;
  }
}
