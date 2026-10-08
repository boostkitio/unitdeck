import Link from "next/link";

/** The public pages, linked from every public footer so none is an orphan. */
export const MARKETING_LINKS = [
  { href: "/templates/call-sheet-template", label: "Free call sheet template" },
  { href: "/compare/studiobinder-alternative", label: "StudioBinder alternative" },
  { href: "/compare/yamdu-alternative", label: "Yamdu alternative" },
] as const;

export function MarketingLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="More from UnitDeck" className="flex flex-wrap gap-x-5 gap-y-2">
      {MARKETING_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className={className}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
