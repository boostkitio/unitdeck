"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CUSTOM = "__custom__";

/**
 * A short list of the usual answers, and room for the one that is not.
 *
 * Frame rates and formats are nearly always one of a handful, and typing
 * "3840x2160" by hand invites a typo on a document a whole crew works from.
 * But a job shooting anamorphic at 96fps still has to be describable, so the
 * list never becomes a cage.
 */
export function PickOrType({
  id,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  value: string | undefined;
  options: string[];
  placeholder?: string;
  onChange: (next: string | undefined) => void;
}) {
  // Sticky: a value that is not on the list means the box was open, and it
  // must stay open while it is being typed — including when it is briefly
  // empty.
  const [typing, setTyping] = useState(
    value !== undefined && value !== "" && !options.includes(value),
  );
  const picked = typing ? CUSTOM : (value ?? "");

  return (
    <div className="space-y-2">
      <Select
        value={picked}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            setTyping(true);
            onChange(undefined);
            return;
          }
          setTyping(false);
          onChange(next === "" || next === null ? undefined : next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          {/* Explicit label: Base UI shows the raw value when items mount late */}
          <SelectValue>
            {typing ? "Something else…" : (value ?? placeholder ?? "Not set")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Not set</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Something else…</SelectItem>
        </SelectContent>
      </Select>
      {typing && (
        <Input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={placeholder}
          autoFocus
        />
      )}
    </div>
  );
}

/** 1080 and UHD cover nearly every job; the rest is typed. */
export const RECORDING_FORMATS = [
  "1920x1080",
  "3840x2160",
  "4096x2160 (DCI 4K)",
  "1280x720",
  "7680x4320 (8K)",
];

/**
 * Every rate anyone shoots at, NTSC and PAL families both. Ordered as a
 * camera menu orders them rather than by which broadcast standard they came
 * from, because that is how they are picked.
 */
export const FRAME_RATES = [
  "23.976 fps",
  "24 fps",
  "25 fps",
  "29.97 fps",
  "30 fps",
  "47.952 fps",
  "48 fps",
  "50 fps",
  "59.94 fps",
  "60 fps",
  "100 fps",
  "119.88 fps",
  "120 fps",
  "240 fps",
];

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "4:3", "2.39:1"];
