/**
 * White paper, before any theme has an opinion.
 *
 * The black frame on emailed quotes was not a background. The `@page` margin
 * is painted by the canvas, and the canvas takes its colour from the root
 * element's `color-scheme` — which the theme sets to `dark` as an inline
 * style on `<html>`, so Chromium painted the margins its dark-mode grey
 * (rgb 18,18,18) around a white sheet. No background rule reaches out there,
 * and only `!important` outranks an inline declaration.
 *
 * The theme is forced light on `/print/*` (see `theme-provider.tsx`), which
 * settles it at the source; this is the belt to that pair of braces, in the
 * document before the theme script runs and not media-scoped, so it holds
 * for screen and for the headless renderer alike.
 */
export function PrintPageStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html:
          "html{color-scheme:light !important;}" +
          "html,body{background:#fff !important;}",
      }}
    />
  );
}
