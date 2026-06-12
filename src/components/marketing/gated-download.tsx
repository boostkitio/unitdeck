"use client";

import { useState } from "react";
import { WaitlistForm } from "./waitlist-form";
import { BRAND } from "@/lib/brand";

export function GatedDownload({ source, file }: { source: string; file: string }) {
  const [unlocked, setUnlocked] = useState(false);

  if (unlocked) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-4">
        <p className="text-sm font-medium text-green-800">
          Done. Your download is ready:{" "}
          <a className="underline underline-offset-2" href={file} download>
            call-sheet-template.pdf
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-sm font-medium">Get the template (free)</p>
      <p className="mt-1 text-sm text-neutral-600">
        Pop your email in and the download unlocks. You&apos;ll also get early access to{" "}
        {BRAND.name} when it opens up.
      </p>
      <div className="mt-3">
        <WaitlistForm source={source} buttonLabel="Get the template" onJoined={() => setUnlocked(true)} />
      </div>
    </div>
  );
}
