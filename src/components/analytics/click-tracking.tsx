"use client";

import { useEffect } from "react";
import { track } from "@vercel/analytics";

/**
 * One delegated click listener for marketing conversion events. Any element
 * with `data-track="<event>"` (and optional `data-track-location`) sends a
 * Vercel Analytics custom event when clicked. A data attribute rather than an
 * onClick keeps pages server-rendered and survives Clerk's SignInButton, which
 * clones its child. There is no GA4 on this site, so only Vercel is called.
 */
export function ClickTracking() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>("[data-track]");
      const name = el?.dataset.track;
      if (!name) return;
      try {
        const location = el.dataset.trackLocation;
        track(name, location ? { location } : {});
      } catch {
        // Analytics must never break the UI.
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
