"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * What a page shows when something in it throws.
 *
 * Without this the framework's own bare error screen replaces the whole app,
 * navigation included, and the only way out is the back button. This keeps the
 * shell, says what happened in a sentence, and offers the two things worth
 * doing: try it again, or go somewhere that works.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-16 text-center">
      <h1 className="font-heading text-xl font-semibold tracking-tight">
        This page ran into a problem
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Nothing you entered elsewhere has been lost. Try the page again, and if it keeps
        happening, send it in with the Feedback button so it can be fixed.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={() => retry()}>
          Try again
        </Button>
        <Button size="sm" variant="secondary" render={<Link href="/dashboard" />}>
          Back to the dashboard
        </Button>
      </div>
    </div>
  );
}
