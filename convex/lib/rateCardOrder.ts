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
 *
 * Until somebody arranges a section by hand. Then the lines in it carry a
 * position, and that wins inside the section: the producer has said what
 * order they want, and grouping related lines together is the reason they
 * moved them. Sections themselves stay in the card's order.
 */

import { RATE_CARD_SEED } from "./rateCardSeed";

export type Orderable = {
  category?: string;
  section?: string;
  name: string;
  sortOrder?: number;
  /** Where the line was put by hand within its section, if anywhere. */
  position?: number;
  _creationTime?: number;
};

/**
 * The block a line is arranged within: its section, inside its category.
 *
 * Category as well as section because a line with no section is grouped
 * under its category on the page, and a hand-typed section name could turn
 * up in two categories.
 */
export function arrangeGroup(line: { category?: string; section?: string }): string {
  return `${line.category ?? ""}|${(line.section ?? "").trim().toLowerCase()}`;
}

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
  return arranged(byCard(lines));
}

/**
 * Applies any hand arrangement on top of the card's order.
 *
 * In a section where some lines have a position, those come first in that
 * order and anything without one — added since — follows in the card's order.
 * Each section's lines go back into the same slots they came out of, so the
 * sections themselves do not move.
 */
function arranged<T extends Orderable>(sorted: T[]): T[] {
  const groups = new Map<string, number[]>();
  for (const line of sorted) {
    if (line.position !== undefined) groups.set(arrangeGroup(line), []);
  }
  if (groups.size === 0) return sorted;
  sorted.forEach((line, i) => groups.get(arrangeGroup(line))?.push(i));

  const out = [...sorted];
  for (const slots of groups.values()) {
    const members = slots.map((i) => sorted[i]);
    // Stable, so lines without a position keep the card's order among themselves.
    const ordered = members
      .map((line, i) => ({ line, i }))
      .sort(
        (a, b) =>
          (a.line.position ?? Number.MAX_SAFE_INTEGER) -
            (b.line.position ?? Number.MAX_SAFE_INTEGER) || a.i - b.i
      )
      .map((x) => x.line);
    slots.forEach((slot, i) => {
      out[slot] = ordered[i];
    });
  }
  return out;
}

function byCard<T extends Orderable>(lines: T[]): T[] {
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
