import { cn } from "@/lib/utils";

/**
 * Contact details look like links, because they are.
 *
 * They used to render as plain muted text that underlined on hover, sitting in
 * a clickable row. Clicking one correctly suppressed the row's dialog and
 * handed off to the mail client or dialler — but with nothing on screen to say
 * it was a link, and the handoff invisible if the browser has no handler
 * registered, it read as a dead click. Underlining them permanently says what
 * they are before they are clicked.
 */
const linkClass =
  "underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground";

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
    <a
      href={`tel:${phone.replace(/\s/g, "")}`}
      title={`Call ${phone}`}
      className={cn(linkClass, className)}
      // Rows and cards are often clickable; dialling should not also navigate.
      onClick={(e) => e.stopPropagation()}
    >
      {phone}
    </a>
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
    <a
      href={`mailto:${address}`}
      title={`Email ${address}`}
      className={cn(linkClass, className)}
      onClick={(e) => e.stopPropagation()}
    >
      {email}
    </a>
  );
}
