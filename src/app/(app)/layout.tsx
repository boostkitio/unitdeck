"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { BRAND } from "@/lib/brand";
import { OrgBootstrap } from "./org-bootstrap";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/people", label: "People" },
  { href: "/clients", label: "Clients" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white px-3 py-4 dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          href="/"
          className="px-2 text-base font-semibold tracking-tight"
          onClick={(e) => {
            if (pathname === "/") {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
        >
          {BRAND.name}
        </Link>
        <div className="mt-4">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/dashboard"
            afterCreateOrganizationUrl="/dashboard"
          />
        </div>
        <nav className="mt-6 flex flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50",
                pathname.startsWith(item.href) &&
                  "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-2">
          <UserButton />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <OrgBootstrap />
        <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>
      </main>
      <Toaster richColors />
    </div>
  );
}
