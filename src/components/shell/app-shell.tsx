import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileTabBar } from "./mobile-tab-bar";
import { DevBanner } from "./dev-banner";
import { devBanner } from "@/lib/deployment";
import { CommandPaletteProvider } from "@/components/command/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  // Read at build time: both are NEXT_PUBLIC_, so these are literals by the
  // time this renders, and the bar cannot disagree with the bundle it shipped in.
  const banner = devBanner(
    process.env.NEXT_PUBLIC_CONVEX_URL,
    process.env.NEXT_PUBLIC_APP_ENV
  );

  return (
    <CommandPaletteProvider>
      {/* The bar's height lives in one CSS variable because three things need
          to agree on it: the bar, the sticky sidebar's top and height, and the
          sticky mobile top bar. Without the banner it resolves to 0px, so the
          production layout is exactly what it was before this existed. */}
      <div
        className="flex min-h-screen flex-col bg-background text-foreground"
        style={{ "--dev-banner-h": banner ? "1.75rem" : "0px" } as React.CSSProperties}
      >
        {banner ? <DevBanner deployment={banner.deployment} /> : null}
        <div className="flex min-w-0 flex-1">
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
        </div>
        <MobileTabBar />
      </div>
    </CommandPaletteProvider>
  );
}
