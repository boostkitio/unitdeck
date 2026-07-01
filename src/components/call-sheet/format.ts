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

export function callStrip(
  data: Pick<CallSheetData, "callTimes" | "generalCallTime">
): CallTimeEntry[] {
  if (data.callTimes && data.callTimes.length > 0) return data.callTimes;
  return [{ id: "general", label: "General call", time: data.generalCallTime }];
}
