/**
 * Every address inside the app, built in one place.
 *
 * An address names a thing the way the office does: a production by its job
 * number, a shoot day by its date, a quote by its reference. The database's
 * own id is only ever the fallback, for a record that has no name of its own
 * yet — and each page reads either, so a link made the old way still opens.
 */

type ProjectLike = { _id: string; jobNumber?: string | null };
type DayLike = { _id: string; date: string };
type QuoteLike = { _id: string; number?: string | null };

/** What the URL calls a production: its job number, or its id before it has one. */
export function projectRef(project: ProjectLike): string {
  return project.jobNumber?.trim() || project._id;
}

/**
 * What the URL calls a shoot day: its date. Two days on one date is not
 * something the calendar makes, but where it has happened the date no longer
 * names one of them, so each goes by its id instead.
 */
export function dayRef(day: DayLike, siblings: readonly DayLike[] = []): string {
  const sharesDate = siblings.some((other) => other._id !== day._id && other.date === day.date);
  return sharesDate ? day._id : day.date;
}

/** What the URL calls a quote: its reference, or its id if it has none. */
export function quoteRef(quote: QuoteLike): string {
  return quote.number?.trim() || quote._id;
}

const seg = encodeURIComponent;

export function projectHref(project: ProjectLike | string): string {
  return `/projects/${seg(typeof project === "string" ? project : projectRef(project))}`;
}

export function kitListHref(project: ProjectLike | string): string {
  return `${projectHref(project)}/kit-list`;
}

export function callSheetHref(project: ProjectLike | string, day: string): string {
  return `${projectHref(project)}/call-sheets/${seg(day)}`;
}

export function combinedCallSheetHref(project: ProjectLike | string): string {
  return `${projectHref(project)}/call-sheets/combined`;
}

export function wrapReportHref(project: ProjectLike | string, day: string): string {
  return `${projectHref(project)}/wrap/${seg(day)}`;
}

export function quoteHref(quote: QuoteLike | string): string {
  return `/quotes/${seg(typeof quote === "string" ? quote : quoteRef(quote))}`;
}

export function quoteViewHref(quote: QuoteLike | string): string {
  return `${quoteHref(quote)}/view`;
}

/**
 * A route parameter as it was written before it went into the address. The
 * router hands a segment over still percent-encoded, so a job number with a
 * space in it arrives as "KLX%2042" and matches nothing until it is decoded.
 */
export function decodeParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    // A stray percent sign is not an encoding; read it as it stands.
    return param;
  }
}

/** Whether two paths are the same address, however each happens to be encoded. */
export function samePath(a: string, b: string): boolean {
  return decodeParam(a) === decodeParam(b);
}
