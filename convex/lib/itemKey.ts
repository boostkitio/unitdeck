/**
 * How two lines are judged to name the same piece of kit.
 *
 * Case and spacing are not what makes "Sony FX9" and " sony  fx9 " different
 * things. Used both by the clash check and by the kit list, which have to
 * agree about what an item is or they contradict each other about the same
 * production.
 */
export function itemKey(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, " ");
}
