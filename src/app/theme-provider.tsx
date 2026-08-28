"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Dark by default, and not following the system: the app is used in edit
 * suites and on set, where a white screen is the wrong answer.
 *
 * The printed documents are the exception. They are rendered by a headless
 * browser that gets no say in the theme, so `/print/*` came out as a dark
 * document: the page background propagates to the canvas and painted the A4
 * margins black around the white sheet — which is what was being emailed to
 * clients. Forcing light there settles it before the theme script runs,
 * rather than fighting the tokens back to white further down.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const printing = pathname?.startsWith("/print") ?? false;
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      forcedTheme={printing ? "light" : undefined}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
