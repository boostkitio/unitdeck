/**
 * The arithmetic behind a quote.
 *
 * Lifted from the spreadsheet this replaces, and deliberately kept pure so it
 * can be proved against real quotes that have already gone out. Every rule
 * here was read off a live quote rather than invented:
 *
 *  - A line carries an internal COST and a client RATE, both per unit.
 *  - The client rate is the cost plus three margins — contingency, profit and
 *    insurance — added, not compounded, then rounded up to a neat figure.
 *    (Contingency 10% + profit 10% + insurance 0.3% is a x1.203 multiplier,
 *    which is exactly what the sheet does.)
 *  - A line can override the rate. That is how a pass-through cost such as
 *    stock licensing is quoted at what it costs, with no margin on it.
 *  - A category total can be overridden too, to land the quote on a round
 *    number. The difference is absorbed into the contingency, which is why a
 *    category with a large pass-through can show negative contingency.
 *
 * Money is in pence throughout. Pounds as floats cannot represent 0.1, and a
 * quote that is a penny out is a quote somebody has to explain.
 */

export type Margins = {
  /** Basis points, so 10% is 1000. Kept integral for the same reason as pence. */
  contingencyBp: number;
  profitBp: number;
  insuranceBp: number;
};

export type QuoteLine = {
  /** Internal cost per unit, in pence. */
  costPence: number;
  /** Client rate per unit, in pence. Absent means "work it out from the cost". */
  ratePence?: number;
  /** How many of them — people, cameras, rooms. */
  pax: number;
  /** How many units each — days, miles, tracks. */
  unitAmount: number;
};

export const BP = 10_000;

/** Rounds up to the nearest `step` pence. The sheet rounds rates to £5. */
export function roundUpTo(pence: number, step: number): number {
  if (step <= 0) return Math.round(pence);
  return Math.ceil(pence / step) * step;
}

/** The multiplier a cost is marked up by, in basis points over 1. */
export function marginBp(margins: Margins): number {
  return margins.contingencyBp + margins.profitBp + margins.insuranceBp;
}

/**
 * What to charge for something that costs `costPence`.
 *
 * Added rather than compounded, which is what the sheet does and is a penny
 * or two cheaper for the client than compounding would be.
 */
export function rateFromCost(
  costPence: number,
  margins: Margins,
  roundToPence = 500
): number {
  const marked = (costPence * (BP + marginBp(margins))) / BP;
  return roundUpTo(marked, roundToPence);
}

/** What a line costs us: everybody, for every unit. */
export function lineCost(line: QuoteLine): number {
  return Math.round(line.costPence * line.pax * line.unitAmount);
}

/** What a line is charged at. An explicit rate wins over the derived one. */
export function lineRate(line: QuoteLine, margins: Margins, roundToPence = 500): number {
  return line.ratePence ?? rateFromCost(line.costPence, margins, roundToPence);
}

/** What a line comes to on the client's sheet. */
export function lineTotal(line: QuoteLine, margins: Margins, roundToPence = 500): number {
  return Math.round(lineRate(line, margins, roundToPence) * line.pax * line.unitAmount);
}

export type CategoryTotals = {
  /** What the work costs us. */
  cost: number;
  contingency: number;
  profit: number;
  insurance: number;
  /** What the client is charged. */
  total: number;
  /** What was added on top of cost-plus-margins to land on `total`. */
  roundUp: number;
};

/**
 * A category's figures.
 *
 * `overrideTotal` is the producer saying "call it fifty-three thousand". The
 * gap between that and cost-plus-margins lands in the contingency, because
 * that is the line that exists to absorb it.
 */
export function categoryTotals(
  lines: QuoteLine[],
  margins: Margins,
  options: { roundToPence?: number; overrideTotal?: number } = {}
): CategoryTotals {
  const roundToPence = options.roundToPence ?? 500;
  const cost = lines.reduce((sum, line) => sum + lineCost(line), 0);
  const contingencyBase = Math.round((cost * margins.contingencyBp) / BP);
  const profit = Math.round((cost * margins.profitBp) / BP);
  const insurance = Math.round((cost * margins.insuranceBp) / BP);

  const charged =
    options.overrideTotal ??
    lines.reduce((sum, line) => sum + lineTotal(line, margins, roundToPence), 0);
  const roundUp = charged - (cost + contingencyBase + profit + insurance);

  return {
    cost,
    contingency: contingencyBase + roundUp,
    profit,
    insurance,
    total: charged,
    roundUp,
  };
}

export type QuoteTotals = {
  cost: number;
  contingency: number;
  profit: number;
  insurance: number;
  /** Before the discount and before VAT. */
  subtotal: number;
  discount: number;
  netTotal: number;
  vat: number;
  grossTotal: number;
};

/**
 * The quote as a whole.
 *
 * The discount comes off before VAT, because VAT is due on what is actually
 * charged rather than on what was nearly charged.
 */
export function quoteTotals(
  categories: CategoryTotals[],
  options: { discountPence?: number; vatBp?: number } = {}
): QuoteTotals {
  const discount = options.discountPence ?? 0;
  const vatBp = options.vatBp ?? 2000;

  const sum = (pick: (c: CategoryTotals) => number) =>
    categories.reduce((total, c) => total + pick(c), 0);

  const subtotal = sum((c) => c.total);
  const netTotal = subtotal - discount;
  const vat = Math.round((netTotal * vatBp) / BP);

  return {
    cost: sum((c) => c.cost),
    contingency: sum((c) => c.contingency),
    profit: sum((c) => c.profit),
    insurance: sum((c) => c.insurance),
    subtotal,
    discount,
    netTotal,
    vat,
    grossTotal: netTotal + vat,
  };
}

/**
 * Where a category stands once real costs are in.
 *
 * The spreadsheet tracks this on its own tab: what was quoted against what has
 * actually been spent, and how much of the contingency is left to spend.
 */
export type CategoryVariance = {
  quoted: number;
  actual: number;
  /** Positive means there is money left in the category. */
  variance: number;
  contingencyLeft: number;
  profitOrLoss: number;
};

export function categoryVariance(
  quoted: CategoryTotals,
  actualPence: number
): CategoryVariance {
  return {
    quoted: quoted.total,
    actual: actualPence,
    variance: quoted.total - actualPence,
    contingencyLeft: quoted.contingency - Math.max(0, actualPence - quoted.cost),
    profitOrLoss: quoted.total - actualPence,
  };
}

/** £1,170.00 from 117000. For anywhere a figure is read rather than summed. */
export function formatPence(pence: number, currency = "£"): string {
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const body = (abs / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}${currency}${body}`;
}
