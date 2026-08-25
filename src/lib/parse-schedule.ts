/**
 * Reading a running order somebody else wrote.
 *
 * A schedule arrives as a paste from Word, a column out of a spreadsheet or a
 * plain list in an email, and it is always the same shape underneath: a time,
 * what happens, and sometimes a note — under a heading that says which day.
 * This turns any of those into rows, and says nothing it is not sure of, so a
 * line it cannot read becomes an untimed item rather than a wrong one.
 */

export type ParsedScheduleLine = {
  /** "HH:MM", or null when the line carries no time. */
  time: string | null;
  item: string;
  notes: string | null;
  /** The day heading this line sat under, verbatim, for showing in a preview. */
  dayHeading: string | null;
  /** An ISO date read out of that heading, when it named one. */
  date: string | null;
  /** "Day 2" counts days rather than naming them; this is the 2. */
  dayNumber: number | null;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun",
];

/** Column separators a pasted table uses: a tab, a pipe, or a run of spaces. */
const COLUMN_SPLIT = /\t+|\s*\|\s*|\s{3,}/;

/** Leading junk between a time and what happens: bullets, dashes, colons. */
const LEAD_JUNK = /^[\s•·*+:>–—-]+/;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A time at the very start of a string, and what is left after it.
 *
 * Deliberately strict: a bare number is not a time, because "24 Studio Way" is
 * an address and reading it as half past midnight would be worse than reading
 * no time at all.
 */
export function takeLeadingTime(text: string): { time: string | null; rest: string } {
  // A bullet or dash in front of the time is decoration, not content.
  const trimmed = text.trim().replace(/^[\s•·*+>–—-]+/, "");
  const patterns: RegExp[] = [
    // 7-8pm, 7.30-8.30pm — one meridiem at the end governs both ends.
    /^(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|to)\s*\d{1,2}(?:[:.]\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/i,
    // 07:00, 7.30, 19:45 — optionally a range, of which the start is taken.
    /^(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*(?:-|–|—|to)\s*\d{1,2}[:.]?\d{0,2}\s*(?:am|pm)?)?/i,
    // 7am, 7 pm, 7-8pm
    /^(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.)(?:\s*(?:-|–|—|to)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)?/i,
    // 0700, military style, four digits and nothing else attached.
    /^(\d{2})(\d{2})(?![\d.:])()/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = (match[3] ?? "").toLowerCase().replace(/\./g, "");
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) continue;
    const rest = trimmed.slice(match[0].length);
    return { time: `${two(hours)}:${two(minutes)}`, rest };
  }
  return { time: null, rest: trimmed };
}

/** An ISO date named anywhere in a line, or null. */
export function readDate(text: string, fallbackYear = new Date().getFullYear()): string | null {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 12/05/2026 and 12-05-26, read day-first as the rest of the app does.
  const slashed = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (slashed) {
    const day = parseInt(slashed[1], 10);
    const month = parseInt(slashed[2], 10);
    let year = parseInt(slashed[3], 10);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${two(month)}-${two(day)}`;
    }
  }

  // 12 May 2026, 12th May, May 12
  const monthNames = Object.keys(MONTHS).join("|");
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})[a-z]*\\.?(?:\\s+(\\d{4}))?`,
    "i",
  );
  const monthFirst = new RegExp(
    `\\b(${monthNames})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
    "i",
  );
  const dm = text.match(dayFirst);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = MONTHS[dm[2].slice(0, 3).toLowerCase()];
    const year = dm[3] ? parseInt(dm[3], 10) : fallbackYear;
    if (day >= 1 && day <= 31) return `${year}-${two(month)}-${two(day)}`;
  }
  const md = text.match(monthFirst);
  if (md) {
    const month = MONTHS[md[1].slice(0, 3).toLowerCase()];
    const day = parseInt(md[2], 10);
    const year = md[3] ? parseInt(md[3], 10) : fallbackYear;
    if (day >= 1 && day <= 31) return `${year}-${two(month)}-${two(day)}`;
  }
  return null;
}

/**
 * Whether a line is a heading announcing a day rather than something that
 * happens on one. A heading carries no time of its own and either counts the
 * days, names a weekday, or gives a date.
 */
function readDayHeading(
  line: string,
): { dayNumber: number | null; date: string | null } | null {
  const text = line.trim().replace(/[:–—-]+$/, "").trim();
  if (text.length === 0 || text.length > 80) return null;
  const lower = text.toLowerCase();

  const counted = lower.match(/^day\s*(\d{1,2})\b/);
  const date = readDate(text);
  const named = WEEKDAYS.some((d) => new RegExp(`^${d}\\b`, "i").test(lower));

  if (!counted && !date && !named) return null;
  // "Monday 07:00 crew call" is a line, not a heading.
  if (takeLeadingTime(text).time !== null) return null;
  if (/\d{1,2}[:.]\d{2}/.test(text)) return null;
  return { dayNumber: counted ? parseInt(counted[1], 10) : null, date };
}

/** Column headings from a pasted table, which are not schedule items. */
function isColumnHeader(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const known = ["time", "start", "when", "item", "activity", "action", "notes", "detail", "scene"];
  return cells
    .filter((c) => c.length > 0)
    .every((c) => known.includes(c.trim().toLowerCase().replace(/[^a-z]/g, "")));
}

/**
 * Every line of a written schedule, in the order it was written.
 *
 * Day headings are consumed rather than returned as items: they say which day
 * the lines under them belong to, which is what the caller needs to match them
 * against the shoot days already on the project.
 */
export function parseSchedule(text: string, fallbackYear?: number): ParsedScheduleLine[] {
  const lines = text.split(/\r?\n/);
  const out: ParsedScheduleLine[] = [];

  let dayHeading: string | null = null;
  let date: string | null = null;
  let dayNumber: number | null = null;
  /** A time that arrived on a line of its own, waiting for what happens. */
  let pendingTime: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const heading = readDayHeading(line);
    if (heading) {
      dayHeading = line.replace(/[:–—-]+$/, "").trim();
      date = heading.date ?? (fallbackYear ? readDate(line, fallbackYear) : heading.date);
      dayNumber = heading.dayNumber;
      pendingTime = null;
      continue;
    }

    // A table pasted out of a spreadsheet or a document keeps its columns.
    const cells = line.split(COLUMN_SPLIT).map((c) => c.trim()).filter((c) => c.length > 0);
    if (isColumnHeader(cells)) continue;

    let time: string | null = null;
    let item = "";
    let notes: string | null = null;

    if (cells.length >= 2) {
      const first = takeLeadingTime(cells[0]);
      if (first.time !== null && first.rest.length === 0) {
        time = first.time;
        item = cells[1];
        notes = cells.slice(2).join(" — ") || null;
      }
    }

    if (item.length === 0) {
      const taken = takeLeadingTime(line);
      time = taken.time;
      const rest = taken.rest.replace(LEAD_JUNK, "").trim();
      // A trailing time — "Lunch 13:00" — is still a time.
      if (time === null) {
        const trailing = rest.match(/[\s(]((?:\d{1,2}[:.]\d{2})\s*(?:am|pm)?)\)?$/i);
        if (trailing) {
          const parsed = takeLeadingTime(trailing[1]);
          if (parsed.time) {
            time = parsed.time;
            item = rest.slice(0, trailing.index).trim();
          }
        }
      }
      if (item.length === 0) item = rest;
      const columns = item.split(COLUMN_SPLIT).map((c) => c.trim()).filter(Boolean);
      if (columns.length > 1) {
        item = columns[0];
        notes = columns.slice(1).join(" — ");
      }
    }

    item = collapseLetterSpacing(item.replace(LEAD_JUNK, "").trim());
    if (notes) notes = collapseLetterSpacing(notes);

    // Copying a table out of a PDF often gives a column at a time, so the
    // time lands on its own line and what happens lands on the next. Hold it
    // for the line that follows rather than throwing it away — that is what
    // left every time blank on a pasted schedule.
    if (item.length === 0) {
      if (time !== null) pendingTime = time;
      continue;
    }
    if (time === null && pendingTime !== null) {
      time = pendingTime;
      pendingTime = null;
    }

    out.push({ time, item, notes: notes || null, dayHeading, date, dayNumber });
  }

  return out;
}

/**
 * Which shoot day a parsed line belongs on.
 *
 * A schedule that names its dates is matched on those. One that just counts
 * ("Day 2") is matched by position in date order, which is what counting
 * means. Anything else is left for the producer to say, rather than guessed.
 */
export function matchDay<T extends { _id: string; date: string }>(
  line: ParsedScheduleLine,
  daysInDateOrder: T[],
): T | null {
  if (line.date) {
    const byDate = daysInDateOrder.find((d) => d.date === line.date);
    if (byDate) return byDate;
  }
  if (line.dayNumber !== null) {
    const byPosition = daysInDateOrder[line.dayNumber - 1];
    if (byPosition) return byPosition;
  }
  return null;
}

/**
 * Words that head a section of a document that is not the running order.
 *
 * A call sheet's crew table has a call time against every name, so it is as
 * dense with times as the schedule is. Times alone cannot tell the two apart;
 * the heading above them can.
 */
const OTHER_SECTIONS = [
  "crew", "cast", "talent", "client", "contacts", "key contacts", "equipment",
  "kit", "camera", "sound", "lighting", "grip", "art", "wardrobe", "makeup",
  "catering", "transport", "parking", "location", "locations", "unit base",
  "safety", "risk", "notes", "weather", "invoicing", "call times", "distribution",
  "agenda items", "attendees", "apologies",
];

/** Words that head the running order itself. */
const SCHEDULE_HEADINGS = [
  "schedule", "shooting schedule", "running order", "runningorder", "run of day",
  "run of show", "timings", "timetable", "programme", "program", "itinerary",
  "order of the day", "day plan",
];

/**
 * Undo the letter-spacing a designer put on a heading.
 *
 * A PDF stores "SCHEDULE" set with wide tracking as the literal characters
 * "S C H E D U L E", spaces and all — that is what the file says, so every
 * extractor reads it that way. Rejoining it is the only way a heading like
 * that can be recognised, and it is safe because ordinary text does not run
 * four single letters together.
 */
export function collapseLetterSpacing(line: string): string {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return line;
  const singles = tokens.filter((t) => t.length === 1).length;
  if (singles / tokens.length < 0.7) return line;
  return tokens.join("");
}

function headingWords(line: string): string {
  return collapseLetterSpacing(line)
    .replace(/[^a-zA-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Whether a line is a heading announcing the running order.
 *
 * Kept tight: a short line that is mostly the word, not a sentence that
 * happens to mention scheduling.
 */
export function isScheduleHeading(line: string): boolean {
  const words = headingWords(line);
  if (words.length === 0 || words.length > 40) return false;
  return SCHEDULE_HEADINGS.some((h) => words === h || words.startsWith(`${h} `));
}

/** Whether a line heads some other part of the document. */
export function isOtherSectionHeading(line: string): boolean {
  const words = headingWords(line);
  if (words.length === 0 || words.length > 30) return false;
  // A heading is a label, not a sentence; three words is generous.
  if (words.split(" ").length > 3) return false;
  return OTHER_SECTIONS.includes(words);
}

/** Whether a line carries a time anywhere it would be read as one. */
function carriesTime(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (takeLeadingTime(trimmed).time !== null) return true;
  // "Lunch 13:00" and "Wrap (18:00)" are timed lines too.
  return /[\s(]\d{1,2}[:.]\d{2}\s*(am|pm)?\)?$/i.test(trimmed);
}

export type ScheduleRegion = {
  /** Just the running order, ready to parse. */
  text: string;
  /** How many lines of the document were left out. */
  skipped: number;
  /** Whether a heading named the section, rather than times alone finding it. */
  namedByHeading: boolean;
};

/** How many untimed lines in a row end a run of schedule. */
const MAX_GAP = 3;
/** Below this, a run of timed lines is a coincidence rather than a schedule. */
const MIN_TIMED_LINES = 3;

/**
 * The running order inside a document that is mostly other things.
 *
 * A schedule arrives buried in a call sheet, a treatment or a production
 * bible, and importing the whole file gives you three hundred lines of crew
 * names and kit. Two clues find it: a heading that says so, and a run of lines
 * that carry times. The heading wins where there is one, because a crew table
 * is just as full of times as the schedule is.
 *
 * Returns null when the document has no run of times worth calling a
 * schedule, which is the caller's cue to use the whole thing.
 */
export function findScheduleRegion(text: string): ScheduleRegion | null {
  const lines = text.split(/\r?\n/);
  const timed = lines.map(carriesTime);

  // Every run of timed lines, allowing short gaps for day headings and the
  // occasional item whose time is not settled.
  const runs: { from: number; to: number; count: number }[] = [];
  let from = -1;
  let last = -1;
  let count = 0;
  const closeRun = () => {
    if (from !== -1) runs.push({ from, to: last, count });
    from = -1;
    count = 0;
  };
  for (let i = 0; i < lines.length; i++) {
    // A heading ends the section above it, however close the next time is.
    // Without this a stray time in one section reaches over the heading and
    // the run appears to start before it.
    if (isScheduleHeading(lines[i]) || isOtherSectionHeading(lines[i])) {
      closeRun();
      continue;
    }
    if (!timed[i]) continue;
    if (from === -1 || i - last > MAX_GAP + 1) {
      closeRun();
      from = i;
    }
    last = i;
    count++;
  }
  closeRun();

  const usable = runs.filter((run) => run.count >= MIN_TIMED_LINES);
  if (usable.length === 0) return null;

  // A heading beats a headcount: prefer the first run that starts under one.
  let chosen: { from: number; to: number; count: number } | null = null;
  let namedByHeading = false;
  for (let i = 0; i < lines.length; i++) {
    if (!isScheduleHeading(lines[i])) continue;
    const under = usable.find((run) => run.from > i && run.from - i <= MAX_GAP + 2);
    if (under) {
      chosen = under;
      namedByHeading = true;
      break;
    }
  }
  if (!chosen) chosen = usable.reduce((best, run) => (run.count > best.count ? run : best));

  // Reach backwards over day headings and forwards over trailing items whose
  // time is not settled, stopping at whatever heads the next section.
  let start = chosen.from;
  while (start > 0) {
    const above = lines[start - 1].trim();
    if (above.length === 0) break;
    if (isScheduleHeading(above) || isOtherSectionHeading(above)) break;
    if (carriesTime(above)) break;
    // Only a day heading is worth reaching back for.
    if (!/^(day\s*\d|mon|tue|wed|thu|fri|sat|sun)/i.test(above)) break;
    start--;
  }

  let end = chosen.to;
  for (let i = chosen.to + 1; i < lines.length && i <= chosen.to + MAX_GAP; i++) {
    const below = lines[i].trim();
    if (below.length === 0) continue;
    if (isScheduleHeading(below) || isOtherSectionHeading(below)) break;
    end = i;
  }

  const kept = lines.slice(start, end + 1);
  const skipped = lines.filter((line) => line.trim().length > 0).length -
    kept.filter((line) => line.trim().length > 0).length;
  return { text: kept.join("\n"), skipped, namedByHeading };
}
