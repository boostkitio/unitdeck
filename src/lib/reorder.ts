/**
 * Dragging a row to a new place in a list.
 *
 * The arithmetic is here rather than in the component because it is the part
 * that is easy to get subtly wrong — an off-by-one when dragging downwards
 * puts the row one short of where it was dropped — and it is the part worth
 * testing without a browser.
 */

/**
 * The list with the item at `from` moved to sit at `to`.
 *
 * Removing first and inserting after means `to` is read against the list as it
 * will be, which is what a drop target means: dropping row 0 onto row 2 lands
 * it third, not second.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * Which slot a pointer at `y` is over, given each row's vertical midpoint.
 *
 * A row is taken once the pointer is past its middle, so the gap you are
 * dropping into is the one the cursor is nearest — dragging down onto the
 * top half of a row means "before it", the bottom half means "after it".
 * Midpoints are in the same coordinate space as `y`, which in practice means
 * both come from getBoundingClientRect.
 */
export function dropIndex(midpoints: number[], y: number): number {
  let index = 0;
  for (const midpoint of midpoints) {
    if (y < midpoint) break;
    index++;
  }
  return index;
}

/**
 * The list with the item at `from` moved into drop `slot`.
 *
 * `slot` counts the gaps in the list as it stands — which is what dropIndex
 * returns — so the gap just above and the gap just below a row both mean
 * "leave it where it is". Everything below a row shifts up when it leaves,
 * hence the adjustment for a downward drag; getting this wrong is what lands
 * a dragged row one short of where it was dropped.
 */
export function moveToSlot<T>(items: T[], from: number, slot: number): T[] {
  if (slot === from || slot === from + 1) return items;
  return moveItem(items, from, slot > from ? slot - 1 : slot);
}
