import { cn } from "@/lib/utils";

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
      className={cn("hover:underline", className)}
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
  return (
    <a
      href={`mailto:${email.trim()}`}
      className={cn("hover:underline", className)}
      onClick={(e) => e.stopPropagation()}
    >
      {email}
    </a>
  );
}
