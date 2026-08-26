import { describe, expect, it } from "vitest";
import { groupAttentionByProject } from "./group-attention";

const item = (projectId: string, projectName: string, label: string) =>
  ({ projectId, projectName, label }) as never;

describe("groupAttentionByProject", () => {
  it("puts everything for one production under one heading", () => {
    const groups = groupAttentionByProject([
      item("p1", "Barclays London", "Book a DP"),
      item("p1", "Barclays London", "Confirm the kit"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].projectName).toBe("Barclays London");
    expect(groups[0].items).toHaveLength(2);
  });

  // The query orders by urgency, so a production can reappear further down the
  // list. Grouping must gather those rather than opening a second heading.
  it("gathers a production that appears again later", () => {
    const groups = groupAttentionByProject([
      item("p1", "Barclays", "Book a DP"),
      item("p2", "Williams", "No location"),
      item("p1", "Barclays", "Confirm the kit"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Book a DP", "Confirm the kit"]);
    expect(groups[1].items.map((i) => i.label)).toEqual(["No location"]);
  });

  // Urgency order is the whole point of the panel, so the most urgent
  // production must still come first.
  it("keeps productions in the order they first appear", () => {
    const groups = groupAttentionByProject([
      item("p2", "Williams", "No location"),
      item("p1", "Barclays", "Book a DP"),
    ]);
    expect(groups.map((g) => g.projectName)).toEqual(["Williams", "Barclays"]);
  });

  it("has nothing to group when nothing needs attention", () => {
    expect(groupAttentionByProject([])).toEqual([]);
  });
});
