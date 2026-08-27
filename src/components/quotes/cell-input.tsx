"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A cell you type in that saves when you leave it.
 *
 * Not the debounced field used elsewhere: a quote is a grid of numbers you
 * tab across, and saving mid-keystroke on a number means the totals jump about
 * while you are still typing. Enter and Tab commit, Escape puts it back.
 *
 * The draft is dropped whenever the saved value changes underneath, so a
 * colleague's edit shows rather than being masked by a stale box.
 */
export function CellInput({
  value,
  onCommit,
  align = "left",
  placeholder,
  className,
  inputMode,
  title,
}: {
  value: string;
  onCommit: (next: string) => void | Promise<void>;
  align?: "left" | "right";
  placeholder?: string;
  className?: string;
  inputMode?: "numeric" | "decimal" | "text";
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const settled = useRef(value);

  useEffect(() => {
    if (settled.current !== value) {
      settled.current = value;
      setDraft(null);
    }
  }, [value]);

  const shown = draft ?? value;

  function commit() {
    if (draft === null || draft === value) {
      setDraft(null);
      return;
    }
    void onCommit(draft);
    setDraft(null);
  }

  return (
    <input
      value={shown}
      title={title}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "w-full rounded-sm bg-transparent px-1.5 py-1 text-sm outline-none",
        "hover:bg-muted/60 focus:bg-background focus:ring-1 focus:ring-ring",
        align === "right" && "text-right tabular-nums",
        className
      )}
    />
  );
}
