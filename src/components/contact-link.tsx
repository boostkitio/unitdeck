"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Contact details as a link, with a copy button beside them.
 *
 * The link alone is not enough. `mailto:` and `tel:` hand off to the operating
 * system, and a page running inside a sandboxed iframe — an embedded browser
 * pane, a preview panel — has that navigation blocked outright. The click does
 * nothing, silently, however well the machine's mail client is set up. Copying
 * the address always works, so there is a way through either way.
 */
const linkClass =
  "underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent) {
    // Rows and cards are often clickable; copying should not also open them.
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied.`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — your browser blocked it.");
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void copy(e)}
      title={`Copy ${label.toLowerCase()}`}
      aria-label={`Copy ${label.toLowerCase()}`}
      className="shrink-0 rounded px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/contact:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

/**
 * Some diallers reject spaces in a tel: URI, so they are stripped from the
 * href while the displayed number keeps its formatting.
 */
export function PhoneLink({
  phone,
  className,
  fallback = "·",
}: {
  phone: string | null | undefined;
  className?: string;
  fallback?: string;
}) {
  if (!phone || phone.trim().length === 0) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  return (
    <span className="group/contact inline-flex min-w-0 items-baseline gap-1">
      <a
        href={`tel:${phone.replace(/\s/g, "")}`}
        title={`Call ${phone}`}
        className={cn("min-w-0 truncate", linkClass, className)}
        onClick={(e) => e.stopPropagation()}
      >
        {phone}
      </a>
      <CopyButton value={phone.trim()} label="Number" />
    </span>
  );
}

export function EmailLink({
  email,
  className,
  fallback = "·",
}: {
  email: string | null | undefined;
  className?: string;
  fallback?: string;
}) {
  if (!email || email.trim().length === 0) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  const address = email.trim();
  return (
    <span className="group/contact inline-flex min-w-0 items-baseline gap-1">
      <a
        href={`mailto:${address}`}
        title={`Email ${address}`}
        className={cn("min-w-0 truncate", linkClass, className)}
        onClick={(e) => e.stopPropagation()}
      >
        {email}
      </a>
      <CopyButton value={address} label="Address" />
    </span>
  );
}
