import type { CallSheetData, CallTimeEntry, EquipmentRow } from "../../../convex/lib/callSheetData";

export function groupEquipmentBySupplier(
  rows: EquipmentRow[]
): { supplier: string | null; items: EquipmentRow[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, EquipmentRow[]>();
  for (const row of rows) {
    const key = row.supplier && row.supplier.trim() !== "" ? row.supplier : null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(row);
  }
  // Ungrouped items always render last.
  order.sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
  return order.map((supplier) => ({ supplier, items: map.get(supplier)! }));
}

/**
 * The general call, taking the schedule's word for it.
 *
 * The running order is what the day actually does, and it is the thing people
 * revise on the morning. When it says the crew are called at 06:30 and the
 * crew panel still says 07:00, the panel is the stale one — so the schedule
 * wins. An item naming a call is preferred over merely the first timed line,
 * since a schedule can open with something that is not a call.
 */
export function scheduledCall(
  data: Pick<CallSheetData, "schedule" | "generalCallTime">
): string {
  return scheduledCallOrNull(data) ?? data.generalCallTime;
}

/**
 * Null when the schedule has nothing timed to say.
 *
 * The distinction matters: with no schedule there is nothing to disagree
 * with, so a crew call somebody set by hand stands. Falling back to the
 * general call here would quietly overwrite it.
 */
function scheduledCallOrNull(
  data: Pick<CallSheetData, "schedule" | "generalCallTime">
): string | null {
  const timed = (data.schedule ?? []).filter((block) => block.start?.trim());
  const named = timed.find((block) => /\bcall\b/i.test(block.title));
  return (named ?? timed[0])?.start ?? null;
}

/** Whether a label names the general or crew call rather than a separate one. */
function isGeneralCall(label: string): boolean {
  const words = label.trim().toLowerCase();
  return words === "crew call" || words === "general call" || words === "call";
}

export function callStrip(
  data: Pick<CallSheetData, "callTimes" | "generalCallTime" | "schedule">
): CallTimeEntry[] {
  const call = scheduledCallOrNull(data);
  if (data.callTimes && data.callTimes.length > 0) {
    if (!call) return data.callTimes;
    // Only the general call follows the schedule; a separate talent or client
    // call is its own arrangement and is left alone.
    return data.callTimes.map((entry) =>
      isGeneralCall(entry.label) ? { ...entry, time: call } : entry
    );
  }
  return [{ id: "general", label: "General call", time: call ?? data.generalCallTime }];
}

/**
 * The call time to print against one person.
 *
 * Somebody on the general call moves with it. Somebody with a time of their
 * own — a later talent call, an earlier rigging call — keeps it.
 */
export function rowCallTime(
  data: Pick<CallSheetData, "schedule" | "generalCallTime">,
  callTime: string | undefined
): string | undefined {
  if (!callTime) return callTime;
  const call = scheduledCallOrNull(data);
  if (!call) return callTime;
  return callTime === data.generalCallTime ? call : callTime;
}
