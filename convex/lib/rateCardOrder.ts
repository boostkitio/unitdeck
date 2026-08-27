/**
 * Where a line belongs on the page.
 *
 * The sheet has an order — Pre Production, then its Casting block, then the
 * crew, the art department, the kit lists section by section — and a producer
 * reads down it the same way every time. Sorting by when a row happened to be
 * created gives a different answer, which is how lines added later ended up in
 * a heap at the bottom.
 *
 * So the order is worked out from the standard card rather than stored: a line
 * knows its section and its name, and that is enough to put it exactly where
 * the sheet puts it, whenever it was added and whatever it was added by. A
 * line nobody recognises — typed by hand for one job — keeps its place at the
 * end of the section it was given, which is where somebody adding it expects
 * to find it.
 */

import { RATE_CARD_SEED } from "./rateCardSeed";

export type Orderable = {
  section?: string;
  name: string;
  sortOrder?: number;
  _creationTime?: number;
};

function key(section: string | undefined, name: string): string {
  return `${(section ?? "").trim().toLowerCase()}::${name.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/** Section headings in the order the sheet lays them out. */
export const SECTION_ORDER: string[] = (() => {
  const seen: string[] = [];
  for (const item of RATE_CARD_SEED) {
    if (!seen.includes(item.section)) seen.push(item.section);
  }
  return seen;
})();

const SECTION_RANK = new Map(SECTION_ORDER.map((section, i) => [section.toLowerCase(), i]));
const LINE_RANK = new Map(RATE_CARD_SEED.map((item, i) => [key(item.section, item.name), i]));

/** Which category a standard section belongs to, for a line that moves. */
export const SECTION_CATEGORY = new Map(
  RATE_CARD_SEED.map((item) => [item.section.toLowerCase(), item.category])
);

/** A section nobody has heard of sorts after every standard one, alphabetically. */
function sectionRank(section: string | undefined): number {
  if (!section) return Number.MAX_SAFE_INTEGER;
  return SECTION_RANK.get(section.trim().toLowerCase()) ?? SECTION_ORDER.length;
}

/**
 * Sorts lines into the sheet's own order.
 *
 * Within a section, standard lines come first in the card's order, then
 * anything typed by hand in the order it was added.
 */
export function inCardOrder<T extends Orderable>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    const bySection = sectionRank(a.section) - sectionRank(b.section);
    if (bySection !== 0) return bySection;
    // Two unknown sections: alphabetical, so the list is at least stable.
    if (sectionRank(a.section) === SECTION_ORDER.length) {
      const byName = (a.section ?? "").localeCompare(b.section ?? "");
      if (byName !== 0) return byName;
    }

    const rankA = LINE_RANK.get(key(a.section, a.name));
    const rankB = LINE_RANK.get(key(b.section, b.name));
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    // A standard line before one typed by hand, whenever it was added.
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;

    return (
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      (a._creationTime ?? 0) - (b._creationTime ?? 0)
    );
  });
}
