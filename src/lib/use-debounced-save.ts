"use client";

import { useEffect, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Saves a field a beat after typing stops, when it differs from what is
 * stored. Returns the state so the field can show a quiet indicator instead
 * of needing a Save button.
 *
 * `save` must be stable — wrap it in useCallback, or the timer restarts on
 * every render and nothing is ever written.
 */
export function useDebouncedSave(
  value: string,
  savedValue: string,
  save: (value: string) => Promise<void>,
  delay = 800,
): SaveState {
  const [state, setState] = useState<SaveState>("idle");

  useEffect(() => {
    if (value === savedValue) return;
    const timer = setTimeout(() => {
      // setState runs in the timeout, not synchronously in the effect body.
      setState("saving");
      save(value)
        .then(() => setState("saved"))
        .catch(() => setState("error"));
    }, delay);
    return () => clearTimeout(timer);
  }, [value, savedValue, save, delay]);

  return state;
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
