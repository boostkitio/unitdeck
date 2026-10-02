/**
 * Which of a production's two kit lists a line sits in: the standard
 * equipment going out, or what is hired in on top.
 */
export type EquipmentSection = "equipment" | "additional";

/**
 * Rows written before the list was split carry no section. They read as
 * "additional", which is the list they were already appearing in — nothing
 * moves out from under anyone.
 */
export function sectionOf(row: { section?: EquipmentSection }): EquipmentSection {
  return row.section ?? "additional";
}

/** What a call sheet files a hire-in under, in place of a department. */
export const HIRED_IN = "Hired in";

/** Whether a call sheet's kit heading is the hire-in one, however it was typed. */
export function isHiredIn(supplier: string | null | undefined): boolean {
  return supplier?.trim().toLowerCase() === HIRED_IN.toLowerCase();
}
