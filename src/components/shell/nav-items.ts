import {
  LayoutDashboardIcon,
  FolderIcon,
  UsersIcon,
  Building2Icon,
  MapPinIcon,
  MessageSquareIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the compact mobile tab bar. Falls back to `label`. */
  shortLabel?: string;
  icon: LucideIcon;
};

/** Full sidebar navigation (desktop). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboardIcon },
  { href: "/projects", label: "Projects", icon: FolderIcon },
  { href: "/people", label: "People", icon: UsersIcon },
  { href: "/clients", label: "Clients", icon: Building2Icon },
  { href: "/locations", label: "Locations", icon: MapPinIcon },
  { href: "/feedback", label: "Feedback", icon: MessageSquareIcon },
];

/** First three become bottom tabs; the rest live in the More sheet. */
export const PRIMARY_TABS: NavItem[] = NAV_ITEMS.slice(0, 3);
export const MORE_ITEMS: NavItem[] = NAV_ITEMS.slice(3);

/** Whether `href` is the active section for the current pathname. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
