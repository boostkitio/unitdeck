/**
 * The order crew are read out in: director first, camera together.
 *
 * Producers arrange a call sheet by department rather than by when each person
 * happened to be booked, and that arrangement does not change between days of
 * the same job. So the order lives on the booking, once per production.
 */
type Orderable = { sortOrder?: number; _creationTime: number };

/**
 * Sorts by the arranged position, then by when the booking was made.
 *
 * Every booking made before the field existed has no position. Those fall to
 * the bottom rather than jumping above crew someone has deliberately arranged,
 * and keep a stable order among themselves. Zero is a real position — the top
 * of the list — so the check is for undefined, not for falsiness.
 */
export function byCrewOrder(a: Orderable, b: Orderable): number {
  const aSet = a.sortOrder !== undefined;
  const bSet = b.sortOrder !== undefined;
  if (aSet && bSet && a.sortOrder !== b.sortOrder) {
    return (a.sortOrder as number) - (b.sortOrder as number);
  }
  if (aSet !== bSet) return aSet ? -1 : 1;
  return a._creationTime - b._creationTime;
}
