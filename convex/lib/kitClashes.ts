import { Doc, Id } from "../_generated/dataModel";
import { itemKey } from "./itemKey";

/**
 * Kit that does not go round: the one way of counting it, shared by the
 * production page, the kit picker and the dashboard so the three can never
 * disagree about the same shoot.
 *
 * Counted a day at a time. A production is on several dates as often as it is
 * on one, and the only question that means anything is whether, on a given
 * day, the productions shooting that day want more of a thing than exists.
 * Adding up everyone who overlaps a three-day job anywhere in its run calls it
 * a clash when Monday's shoot and Wednesday's each take the one spare tripod.
 */

/** How many of each thing the company owns, by what it is called. */
export type KitStock = Map<string, { count: number; item: string }>;

type Wanted = {
  count: number;
  /** The exact inventory records claimed, where a line names one. */
  units: Set<Id<"equipment">>;
  rowIds: Id<"projectEquipment">[];
};

/** What each production wants of each thing the company owns. */
export type KitDemand = Map<string, Map<Id<"projects">, Wanted>>;

export type KitClash = {
  /** Normalised item name — what the clash is about. */
  key: string;
  item: string;
  /** How many of it the company owns. */
  stock: number;
  /** How many this production wants. */
  mine: number;
  /** Lines on this production, so a clash can be cleared from here. */
  rowIds: Id<"projectEquipment">[];
  /**
   * True when the very same piece of kit — the same inventory record — is
   * booked on both. That is a clash whether or not there are others like it
   * spare, because both productions are holding the same object.
   */
  sameUnit: boolean;
  /** The days it does not go round, earliest first. */
  dates: string[];
  others: {
    projectId: Id<"projects">;
    /** How many that production wants. */
    count: number;
    /** The days it is part of the problem, earliest first. */
    dates: string[];
  }[];
};

export function kitStock(inventory: Doc<"equipment">[]): KitStock {
  const stock: KitStock = new Map();
  for (const kit of inventory) {
    if (kit.archived) continue;
    const key = itemKey(kit.item);
    const held = stock.get(key);
    if (held) held.count++;
    else stock.set(key, { count: 1, item: kit.item });
  }
  return stock;
}

/**
 * Kit with no inventory record is a hire-in — there is no fixed number of
 * those, so it cannot run out and is left out of the count altogether.
 */
export function kitDemand(lines: Doc<"projectEquipment">[], stock: KitStock): KitDemand {
  const demand: KitDemand = new Map();
  for (const line of lines) {
    const key = itemKey(line.item);
    if (!stock.has(key)) continue;
    const byProject = demand.get(key) ?? new Map<Id<"projects">, Wanted>();
    const entry = byProject.get(line.projectId) ?? {
      count: 0,
      units: new Set<Id<"equipment">>(),
      rowIds: [],
    };
    entry.count += line.quantity ?? 1;
    entry.rowIds.push(line._id);
    if (line.equipmentId) entry.units.add(line.equipmentId);
    byProject.set(line.projectId, entry);
    demand.set(key, byProject);
  }
  return demand;
}

/**
 * Who else wants a thing on one day, and whether that day is a problem.
 *
 * Two ways it goes wrong, and they are not the same thing. The same physical
 * item booked on both: whichever production takes it, the other has nothing,
 * and owning five more like it does not help because neither asked for those.
 * Or simply more wanted than exists, however the lines were written.
 */
function dayOf(
  date: string,
  projectId: Id<"projects">,
  mine: { count: number; units: Set<Id<"equipment">> },
  byProject: Map<Id<"projects">, Wanted>,
  held: number,
  datesByProject: Map<Id<"projects">, Set<string>>
) {
  const sharing: { projectId: Id<"projects">; count: number; sameUnit: boolean }[] = [];
  let total = mine.count;
  for (const [otherId, other] of byProject) {
    if (otherId === projectId) continue;
    if (!datesByProject.get(otherId)?.has(date)) continue;
    total += other.count;
    sharing.push({
      projectId: otherId,
      count: other.count,
      sameUnit: [...other.units].some((unit) => mine.units.has(unit)),
    });
  }
  const overflow = total > held;
  // When there is enough to go round, only the productions holding the very
  // same object are in the way; when there is not, everyone wanting it is.
  const involved = overflow ? sharing : sharing.filter((other) => other.sameUnit);
  return { overflow, involved, total };
}

/**
 * Kit one production wants that it cannot have.
 *
 * `datesByProject` decides who is competing: leave a production out of it —
 * an archived one, one with no dates — and it is not counted at all.
 */
export function clashesFor(
  projectId: Id<"projects">,
  demand: KitDemand,
  stock: KitStock,
  datesByProject: Map<Id<"projects">, Set<string>>
): KitClash[] {
  const myDates = [...(datesByProject.get(projectId) ?? [])].sort();
  if (myDates.length === 0) return [];

  const clashes: KitClash[] = [];
  for (const [key, byProject] of demand) {
    const mine = byProject.get(projectId);
    if (!mine || byProject.size < 2) continue;
    const held = stock.get(key)!;

    const dates: string[] = [];
    let sameUnit = false;
    const others = new Map<Id<"projects">, { count: number; dates: string[] }>();
    for (const date of myDates) {
      const day = dayOf(date, projectId, mine, byProject, held.count, datesByProject);
      if (day.involved.length === 0) continue;
      dates.push(date);
      for (const other of day.involved) {
        if (other.sameUnit) sameUnit = true;
        const entry = others.get(other.projectId);
        if (entry) entry.dates.push(date);
        else others.set(other.projectId, { count: other.count, dates: [date] });
      }
    }
    if (dates.length === 0) continue;

    clashes.push({
      key,
      item: held.item,
      stock: held.count,
      mine: mine.count,
      rowIds: mine.rowIds,
      sameUnit,
      dates,
      others: [...others.entries()].map(([otherId, other]) => ({ projectId: otherId, ...other })),
    });
  }

  clashes.sort((a, b) => a.item.localeCompare(b.item));
  return clashes;
}

export type KitBooking = {
  /** The piece of kit, when it is one exact object that is spoken for. */
  equipmentId?: Id<"equipment">;
  /** Normalised item name, for kit that is all out rather than one unit of it. */
  key: string;
  /** Who has it: one production for an exact unit, everyone wanting it otherwise. */
  projectIds: Id<"projects">[];
  /** The days of this production it is unavailable on, earliest first. */
  dates: string[];
};

/**
 * What is already spoken for on this production's dates, before any of it is
 * added here: the exact units another production holds, and the things every
 * one of which is out.
 *
 * This is the question the picker asks. A clash is only raised once a line is
 * on both productions, which is too late to be told — the point of seeing it
 * in the list is choosing the other camera body instead.
 */
export function bookedElsewhere(
  projectId: Id<"projects">,
  demand: KitDemand,
  stock: KitStock,
  datesByProject: Map<Id<"projects">, Set<string>>
): KitBooking[] {
  const myDates = [...(datesByProject.get(projectId) ?? [])].sort();
  if (myDates.length === 0) return [];

  const bookings: KitBooking[] = [];
  for (const [key, byProject] of demand) {
    const held = stock.get(key)!;
    const mine = byProject.get(projectId) ?? { count: 0, units: new Set<Id<"equipment">>() };

    // Exact units held by somebody else on one of these days.
    const units = new Map<Id<"equipment">, { projectIds: Set<Id<"projects">>; dates: Set<string> }>();
    // Days on which there is none left to add, and who has them.
    const full = { projectIds: new Set<Id<"projects">>(), dates: new Set<string>() };

    for (const [otherId, other] of byProject) {
      if (otherId === projectId) continue;
      const shared = myDates.filter((date) => datesByProject.get(otherId)?.has(date));
      if (shared.length === 0) continue;
      for (const unit of other.units) {
        const entry = units.get(unit) ?? { projectIds: new Set(), dates: new Set() };
        entry.projectIds.add(otherId);
        for (const date of shared) entry.dates.add(date);
        units.set(unit, entry);
      }
    }
    for (const date of myDates) {
      const day = dayOf(date, projectId, mine, byProject, held.count, datesByProject);
      // One more here would be one too many.
      if (day.total < held.count || day.total === mine.count) continue;
      full.dates.add(date);
      for (const [otherId] of byProject) {
        if (otherId !== projectId && datesByProject.get(otherId)?.has(date)) {
          full.projectIds.add(otherId);
        }
      }
    }

    for (const [equipmentId, entry] of units) {
      bookings.push({
        equipmentId,
        key,
        projectIds: [...entry.projectIds],
        dates: [...entry.dates].sort(),
      });
    }
    if (full.dates.size > 0) {
      bookings.push({ key, projectIds: [...full.projectIds], dates: [...full.dates].sort() });
    }
  }
  return bookings;
}
