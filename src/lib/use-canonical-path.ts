"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { decodeParam, samePath } from "@/lib/routes";

/**
 * Moves the address bar to the page's proper address once it is known.
 *
 * A page opens from a job number, a date or a quote reference, and also from
 * the database id that older links and freshly created records carry. Either
 * finds the record; this then swaps the address for the readable one, so what
 * gets copied and shared is the address anybody would recognise.
 *
 * The history entry is replaced in place rather than navigated to. Nothing is
 * fetched again and nothing remounts, which matters when the address changes
 * because of what is being typed: renumbering a job or a quote must not throw
 * the cursor out of the box that is doing it.
 */
export function useCanonicalPath(canonical: string | null | undefined) {
  const pathname = usePathname();
  useEffect(() => {
    if (!canonical || samePath(pathname, canonical)) return;
    window.history.replaceState(null, "", canonical);
  }, [canonical, pathname]);
}

/**
 * The reference to look a record up by, which starts as whatever the address
 * holds and becomes the record's own id once it has been found.
 *
 * A job number or a quote reference can be changed, by you on this page or by
 * a colleague on theirs. Looked up by the name in the address, the record
 * would vanish the moment it was renamed and the page would say "not found"
 * about something it was showing a second ago. The id never changes, so once
 * the record is known the page holds on to it by that, and `useCanonicalPath`
 * keeps the address in step with the new name.
 *
 * Call `pin` with the found record's id on every render. A different route
 * parameter is a different record, so the pin only holds for the parameter it
 * was made under.
 */
/**
 * A query result that does not blink back to "loading" when the same record
 * is asked for a second way.
 *
 * Pinning swaps the lookup from the name in the address to the record's id,
 * and a query with new arguments has no answer until the server gives one.
 * For that moment this hands back the answer already on screen, so the page
 * does not flash a skeleton and unmount a form somebody is typing in. Held
 * only for the route parameter it was loaded under: another parameter is
 * another record, and must not show this one's.
 */
export function useHeld<T>(param: string, result: T | undefined): T | undefined {
  const [held, setHeld] = useState<{ param: string; value: T } | null>(null);
  if (result !== undefined && (held?.param !== param || held.value !== result)) {
    setHeld({ param, value: result });
  }
  if (result !== undefined) return result;
  return held?.param === param ? held.value : undefined;
}

export function usePinnedRef(param: string): {
  ref: string;
  pin: (id: string | null | undefined) => void;
} {
  const wanted = decodeParam(param);
  const [pinned, setPinned] = useState<{ param: string; id: string } | null>(null);
  const held = pinned?.param === wanted ? pinned.id : null;
  return {
    ref: held ?? wanted,
    pin: (id) => {
      if (id && id !== held) setPinned({ param: wanted, id });
    },
  };
}
