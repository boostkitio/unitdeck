"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher } from "@clerk/nextjs";
import { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeToggle } from "./theme-toggle";
import { MORE_ITEMS, isActive } from "./nav-items";
import { cn } from "@/lib/utils";

/**
 * `children` must be a single React element — it is passed directly to Base UI's
 * `SheetTrigger render` prop, which does not accept arbitrary nodes (strings/arrays/null).
 */
export function MoreSheet({ children }: { children: React.ReactElement }) {
  const pathname = usePathname();
  return (
    <Sheet>
      <SheetTrigger render={children} />
      <SheetContent>
        <SheetTitle className="px-1 pb-1 font-heading text-sm">More</SheetTitle>
        <div className="flex items-center justify-between gap-2 px-1 py-2">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
          />
          <ThemeToggle />
        </div>
        <nav className="flex flex-col">
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <SheetClose
                key={item.href}
                render={
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                      active && "bg-muted text-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                }
              />
            );
          })}
        </nav>
        <div className="mt-2 border-t border-border pt-3">
          <FeedbackButton />
        </div>
      </SheetContent>
    </Sheet>
  );
}
