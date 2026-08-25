"use client";

import { ContactBook } from "../people/page";

/**
 * The talent book. Same page as People with a different heading: talent are
 * the same record — a name, a role, contact details — kept in their own list
 * because that is how a production office thinks about them, and because a
 * call sheet lists them separately.
 */
export default function TalentPage() {
  return <ContactBook kind="talent" />;
}
