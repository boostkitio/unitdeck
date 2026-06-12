import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * The UnitDeck lockup: stacked-layers mark plus Unbounded wordmark.
 * Inherits colour from the surrounding text (currentColor), so it is white on
 * dark surfaces and ink on light ones. `size` is the wordmark font size in px;
 * the mark and gap scale with it.
 */
export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap", className)}
      style={{ fontSize: size }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 134 117"
        fill="currentColor"
        aria-hidden="true"
        style={{ height: "1.25em", width: "auto", marginRight: "0.5em", transform: "translateY(0.04em)" }}
      >
        <path d="M0 83.6663L66.672 100.333L133.333 83.6663V100.333L66.672 117L0 100.333V83.6663ZM0 50.333L66.672 66.9997L133.333 50.333V66.9997L66.672 83.6663L0 66.9997V50.333ZM0 16.9997L66.672 0.333008L133.333 16.9997V33.6663L66.672 50.333L0 33.6663V16.9997Z" />
      </svg>
      <span
        style={{
          fontFamily: "var(--font-unbounded)",
          fontWeight: 600,
          letterSpacing: 0,
          lineHeight: 1,
        }}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
