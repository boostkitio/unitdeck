"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useTheme } from "next-themes";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  SearchIcon,
  FolderIcon,
  UsersIcon,
  Building2Icon,
  MapPinIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  SunIcon,
  MoonIcon,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type CommandPaletteContextValue = {
  open: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

type Entry = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  run: () => void;
};

// ---------------------------------------------------------------------------
// Provider + palette
// ---------------------------------------------------------------------------

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { organization } = useOrganization();

  // Convex data queries – org-scoped, mirroring the pattern on each page
  const projects = useQuery(api.projects.list, organization ? {} : "skip");
  const people = useQuery(api.people.list, organization ? {} : "skip");
  const clients = useQuery(api.clients.list, organization ? {} : "skip");
  const locations = useQuery(api.locations.list, organization ? {} : "skip");

  const openPalette = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setHighlighted(0);
  }, []);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => (prev ? false : true));
        if (!isOpen) {
          setQuery("");
          setHighlighted(0);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Build the full entry list
  const staticGoTo: Entry[] = [
    {
      id: "goto-dashboard",
      group: "Go to",
      label: "Dashboard",
      icon: LayoutDashboardIcon,
      run: () => { router.push("/dashboard"); closePalette(); },
    },
    {
      id: "goto-projects",
      group: "Go to",
      label: "Projects",
      icon: FolderIcon,
      run: () => { router.push("/projects"); closePalette(); },
    },
    {
      id: "goto-people",
      group: "Go to",
      label: "People",
      icon: UsersIcon,
      run: () => { router.push("/people"); closePalette(); },
    },
    {
      id: "goto-clients",
      group: "Go to",
      label: "Clients",
      icon: Building2Icon,
      run: () => { router.push("/clients"); closePalette(); },
    },
    {
      id: "goto-locations",
      group: "Go to",
      label: "Locations",
      icon: MapPinIcon,
      run: () => { router.push("/locations"); closePalette(); },
    },
    {
      id: "goto-feedback",
      group: "Go to",
      label: "Feedback",
      icon: MessageSquareIcon,
      run: () => { router.push("/feedback"); closePalette(); },
    },
  ];

  const staticActions: Entry[] = [
    {
      id: "action-new-project",
      group: "Actions",
      label: "New project",
      icon: FolderIcon,
      run: () => { router.push("/projects"); closePalette(); },
    },
    {
      id: "action-toggle-theme",
      group: "Actions",
      label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      icon: resolvedTheme === "dark" ? SunIcon : MoonIcon,
      run: () => {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        closePalette();
      },
    },
  ];

  // When there's a query, also include data entries
  const trimmed = query.trim().toLowerCase();

  const projectEntries: Entry[] = (projects ?? [])
    .filter((p) => p.name.toLowerCase().includes(trimmed) || (p.clientName ?? "").toLowerCase().includes(trimmed))
    .map((p) => ({
      id: `project-${p._id}`,
      group: "Projects",
      label: p.name,
      hint: p.clientName ?? undefined,
      icon: FolderIcon,
      run: () => { router.push(`/projects/${p._id}`); closePalette(); },
    }));

  const peopleEntries: Entry[] = (people ?? [])
    .filter((p) => p.name.toLowerCase().includes(trimmed) || p.role.toLowerCase().includes(trimmed))
    .map((p) => ({
      id: `person-${p._id}`,
      group: "People",
      label: p.name,
      hint: p.role,
      icon: UsersIcon,
      run: () => { router.push("/people"); closePalette(); },
    }));

  const clientEntries: Entry[] = (clients ?? [])
    .filter((c) => c.name.toLowerCase().includes(trimmed))
    .map((c) => ({
      id: `client-${c._id}`,
      group: "Clients",
      label: c.name,
      icon: Building2Icon,
      run: () => { router.push("/clients"); closePalette(); },
    }));

  const locationEntries: Entry[] = (locations ?? [])
    .filter(
      (l) =>
        l.name.toLowerCase().includes(trimmed) ||
        (l.address ?? "").toLowerCase().includes(trimmed)
    )
    .map((l) => ({
      id: `location-${l._id}`,
      group: "Locations",
      label: l.name,
      hint: l.address,
      icon: MapPinIcon,
      run: () => { router.push("/locations"); closePalette(); },
    }));

  // When query is empty show only static groups; when there's a query show all
  const allEntries: Entry[] = trimmed
    ? [
        ...projectEntries,
        ...peopleEntries,
        ...clientEntries,
        ...locationEntries,
        ...staticGoTo.filter((e) => e.label.toLowerCase().includes(trimmed)),
        ...staticActions.filter((e) => e.label.toLowerCase().includes(trimmed)),
      ]
    : [...staticGoTo, ...staticActions];

  // Keyboard navigation inside the palette
  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % Math.max(allEntries.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + Math.max(allEntries.length, 1)) % Math.max(allEntries.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = allEntries[highlighted];
      if (entry) entry.run();
    }
  }

  // Group the entries for rendering
  const groups: { name: string; entries: Entry[] }[] = [];
  for (const entry of allEntries) {
    const existing = groups.find((g) => g.name === entry.group);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.push({ name: entry.group, entries: [entry] });
    }
  }

  // Flat index map for highlight
  let flatIndex = 0;

  return (
    <CommandPaletteContext.Provider value={{ open: openPalette }}>
      {children}
      <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open) closePalette(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Popup className="fixed top-[12%] left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-popover shadow-2xl ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:max-w-lg">
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-border px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                placeholder="Search or jump to…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
                onKeyDown={handleInputKeyDown}
                className="w-full bg-transparent py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                aria-label="Search"
                aria-autocomplete="list"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto p-1.5" role="listbox" aria-label="Results">
              {allEntries.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No matches</p>
              ) : (
                groups.map((group) => (
                  <div key={group.name} className="mb-1">
                    <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {group.name}
                    </p>
                    {group.entries.map((entry) => {
                      const thisIndex = flatIndex++;
                      const isHighlighted = thisIndex === highlighted;
                      const Icon = entry.icon;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted}
                          onMouseEnter={() => setHighlighted(thisIndex)}
                          onClick={() => entry.run()}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors",
                            isHighlighted ? "bg-muted" : "hover:bg-muted/60"
                          )}
                        >
                          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
                          <span className="flex-1 truncate">{entry.label}</span>
                          {entry.hint && (
                            <span className="shrink-0 truncate text-xs text-muted-foreground">
                              {entry.hint}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> select</span>
              <span><kbd className="font-mono">Esc</kbd> close</span>
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </CommandPaletteContext.Provider>
  );
}
