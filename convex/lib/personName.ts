/**
 * How a person on the account is named, given everything we might know.
 *
 * Three sources, in order of who is most likely to be right:
 *
 *  1. The name they typed into UnitDeck. They chose it, so it wins.
 *  2. The name Clerk holds, which is filled in by Google or GitHub at signup
 *     and is otherwise usually blank.
 *  3. Their email address, which is not a name but is at least a person.
 *
 * Pure, and deliberately in convex/lib so both the backend and the browser can
 * use the same rule — a name that differed between the two would be worse than
 * no name at all.
 */

export type NameParts = {
  firstName?: string | null;
  lastName?: string | null;
};

/** Joins a first and last name, tolerating either being missing or blank. */
export function joinName(parts: NameParts | null | undefined): string {
  if (!parts) return "";
  return [parts.firstName, parts.lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * The name to show for somebody, or `fallback` when we know nothing at all.
 *
 * `chosen` is what they set in UnitDeck; `fromAuth` is whatever Clerk has.
 */
export function displayName({
  chosen,
  fromAuth,
  email,
  fallback = "A member",
}: {
  chosen?: NameParts | null;
  fromAuth?: NameParts | null;
  email?: string | null;
  fallback?: string;
}): string {
  const own = joinName(chosen);
  if (own) return own;
  const auth = joinName(fromAuth);
  if (auth) return auth;
  const address = typeof email === "string" ? email.trim() : "";
  if (address) return address;
  return fallback;
}
