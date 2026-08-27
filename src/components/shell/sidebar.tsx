"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher } from "@clerk/nextjs";
import { AccountButton } from "@/components/shell/account-button";
import { SearchIcon } from "lucide-react";
import { Logo } from "@/components/logo";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeToggle } from "./theme-toggle";
import { NAV_ITEMS, isActive } from "./nav-items";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "@/components/command/command-palette";

export function Sidebar() {
  const pathname = usePathname();
  const { open } = useCommandPalette();

  // Sticky rather than fixed: it stays in the flex row, so the main column
  // still sits beside it without needing a matching left margin. h-screen plus
  // its own overflow means a long nav scrolls inside the sidebar, not with the
  // page.
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4 md:sticky md:top-0 md:flex md:h-screen md:overflow-y-auto">
      <Link
        href="/"
        className="px-2"
        onClick={(e) => {
          if (pathname === "/") {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      >
        <Logo size={15} />
      </Link>
      <div className="mt-4">
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
        />
      </div>
      <nav className="mt-6 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-muted text-foreground"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3">
        <button
          type="button"
          onClick={open}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
            ⌘K
          </kbd>
        </button>
        <FeedbackButton />
        <div className="flex items-center justify-between px-2">
          <AccountButton />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
