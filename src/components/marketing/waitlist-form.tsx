"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function WaitlistForm({
  source,
  buttonLabel = "Join the waitlist",
  onJoined,
}: {
  source: string;
  buttonLabel?: string;
  onJoined?: () => void;
}) {
  const join = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  if (state === "done") {
    return (
      <p className="text-sm font-medium text-green-600">
        You&apos;re on the list. Expect an email when Unit opens up.
      </p>
    );
  }

  return (
    <form
      className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        try {
          await join({ email, source, website });
          setState("done");
          onJoined?.();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
          setState("error");
        }
      }}
    >
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <input
        type="email"
        required
        placeholder="you@productioncompany.co.uk"
        className="h-11 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        type="submit"
        disabled={state === "busy"}
        className="h-11 shrink-0 rounded-md bg-neutral-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-60"
      >
        {state === "busy" ? "Joining…" : buttonLabel}
      </button>
      {state === "error" && <p className="text-sm text-red-600 sm:self-center">{error}</p>}
    </form>
  );
}
