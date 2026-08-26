import type { AttentionItem } from "../../convex/dashboard";

export type AttentionGroup = {
  projectId: AttentionItem["projectId"];
  projectName: string;
  items: AttentionItem[];
};

/**
 * The attention list, gathered under the production each item belongs to.
 *
 * Flat, the panel repeats the production's name and a link to it on every
 * line, so four things missing from one job read as four unrelated problems.
 * Grouped, it reads as one job needing four things — which is how someone
 * decides what to pick up next.
 *
 * The query orders by urgency and that ordering is the point, so productions
 * keep the position of their first item rather than being sorted again here.
 */
export function groupAttentionByProject(items: AttentionItem[]): AttentionGroup[] {
  const groups = new Map<string, AttentionGroup>();
  for (const item of items) {
    const key = String(item.projectId);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        projectId: item.projectId,
        projectName: item.projectName,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}
