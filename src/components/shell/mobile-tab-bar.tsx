"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { PRIMARY_TABS, isActive } from "./nav-items";
import { MoreSheet } from "./more-sheet";
import { cn } from "@/lib/utils";

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    /* h-16 plus safe-area padding squashed the icons into whatever the home
       indicator left of 64px. Adding the inset to the height instead keeps the
       row a stable 64px on every handset. */
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }}
    >
      {PRIMARY_TABS.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors",
              active && "text-primary"
            )}
          >
            <Icon className="size-5" />
            {item.shortLabel ?? item.label}
          </Link>
        );
      })}
      <MoreSheet>
        <button
          type="button"
          aria-label="More navigation"
          className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors aria-expanded:text-primary"
        >
          <MenuIcon className="size-5" />
          More
        </button>
      </MoreSheet>
    </nav>
  );
}
