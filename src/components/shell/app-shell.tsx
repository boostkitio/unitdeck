import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileTabBar } from "./mobile-tab-bar";
import { CommandPaletteProvider } from "@/components/command/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1">
            {/* One width for every tab, so the tables line up as you move
                between them. 1600px because a 1080p screen has about that
                much left after the 14rem sidebar and the padding: the wide
                tables (people, equipment) fit without scrolling sideways,
                and an ultrawide monitor still stops short of the line
                lengths that make prose hard to read.

                pb-24 on mobile clears the fixed bottom tab bar (plus the
                home-indicator safe area). */}
            <div className="mx-auto max-w-[1600px] px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">
              {children}
            </div>
          </main>
        </div>
        <MobileTabBar />
      </div>
    </CommandPaletteProvider>
  );
}
