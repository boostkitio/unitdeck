import { describe, expect, test } from "vitest";
import {
  categoryTotals,
  costFromRate,
  categoryVariance,
  formatPence,
  lineCost,
  lineTotal,
  quoteTotals,
  rateFromCost,
  roundUpTo,
  type Margins,
  type QuoteLine,
} from "./quoteMath";

/** £ to pence, so the tests can be read against the quote they came from. */
const p = (pounds: number) => Math.round(pounds * 100);

/**
 * The margins on quote 26_Ala_QV1 — contingency 10%, profit 10%,
 * insurance 0.30%, which is the x1.203 the sheet marks costs up by.
 */
const VEEAM: Margins = { contingencyBp: 1000, profitBp: 1000, insuranceBp: 30 };

/** The blank template's margins: no profit, so x1.103. */
const TEMPLATE: Margins = { contingencyBp: 1000, profitBp: 0, insuranceBp: 30 };

describe("roundUpTo", () => {
  test("rounds up to the nearest fiver, and leaves one that already is", () => {
    expect(roundUpTo(p(536.37), 500)).toBe(p(540));
    expect(roundUpTo(p(540), 500)).toBe(p(540));
    expect(roundUpTo(p(540.01), 500)).toBe(p(545));
  });
});

// The rate card in the sheet is cost x (1 + contingency + profit + insurance),
// rounded up to £5. These are read straight off it.
describe("rateFromCost reproduces the rate card", () => {
  test.each([
    ["Producer", 486.28, 585],
    ["Production Manager", 349.12, 420],
    ["Director - Prep Day", 498.75, 600],
    ["Location Scout", 299.25, 360],
    ["Director of Photography", 457.19, 550],
    ["Camera Op", 399.0, 480],
    ["Sound Op (with kit)", 644.22, 775],
    ["Per Diems", 29.09, 35],
  ])("%s at 10/10/0.3", (_role, cost, rate) => {
    expect(rateFromCost(p(cost), VEEAM)).toBe(p(rate));
  });

  // Two rate-card rows are left out of the table above on purpose. The sheet
  // shows costs to the penny but stores more precision, and Director - Shoot
  // and Drone Op both land within a penny of a multiple of five. Rounding up
  // from the displayed cost gives £655 and £2,405; rounding up from the real
  // one gives the £650 and £2,400 on the quote. The rule is right, the input
  // is what is lossy — which is why a quote stores the rate it went out at
  // rather than deriving it again later.
  test("a cost a hair under a fiver boundary stays on the boundary", () => {
    expect(rateFromCost(p(540.2909), VEEAM)).toBe(p(650));
    expect(rateFromCost(p(1995.0083), VEEAM)).toBe(p(2400));
  });

  test.each([
    ["Producer", 486.28, 540],
    ["Production Manager", 349.12, 390],
    ["Runner", 207.81, 230],
    ["Gaffer", 548.62, 610],
    ["DIT", 698.25, 775],
    ["VFX Supervisor", 798.0, 885],
    ["Drone Op", 1995.01, 2205],
  ])("%s at 10/0/0.3", (_role, cost, rate) => {
    expect(rateFromCost(p(cost), TEMPLATE)).toBe(p(rate));
  });
});

// Typing a rate is how a producer works: they know what the job will bear.
describe("costFromRate runs the rate card backwards", () => {
  // Within a penny of the cost the sheet holds for these rates. It cannot be
  // closer: the rate is rounded to £5, so a range of costs produces each one.
  test("a rate implies the cost carrying those margins", () => {
    expect(costFromRate(p(585), VEEAM)).toBeCloseTo(p(486.28), -0.5);
    expect(costFromRate(p(420), VEEAM)).toBeCloseTo(p(349.13), -0.5);
    expect(costFromRate(p(775), VEEAM)).toBeCloseTo(p(644.22), -0.5);
  });

  test("with no margins at all the cost is the rate", () => {
    const none = { contingencyBp: 0, profitBp: 0, insuranceBp: 0 };
    expect(costFromRate(p(21800), none)).toBe(p(21800));
  });

  // It cannot be an exact inverse: rounding up to £5 throws away which cost
  // produced the rate. What it must do is never claim a margin that is not
  // there, so the cost it returns must round back to the rate it was given.
  test("the cost it gives back re-prices to the rate it was given", () => {
    for (const rate of [35, 150, 420, 585, 775, 2400, 21800]) {
      expect(rateFromCost(costFromRate(p(rate), VEEAM), VEEAM)).toBe(p(rate));
    }
  });
});

describe("a line", () => {
  test("multiplies by how many people and how many days", () => {
    // Location Scout: 2 pax, 1 day, £360 — £720 on the sheet.
    const line: QuoteLine = { costPence: p(299.25), pax: 2, unitAmount: 1 };
    expect(lineTotal(line, VEEAM)).toBe(p(720));
    expect(lineCost(line)).toBe(p(598.5));
  });

  test("an explicit rate wins, which is how a pass-through is quoted", () => {
    // Stock licensing: £21,800 charged at cost, no margin on it.
    const line: QuoteLine = {
      costPence: p(21800),
      ratePence: p(21800),
      pax: 1,
      unitAmount: 1,
    };
    expect(lineTotal(line, VEEAM)).toBe(p(21800));
  });
});

// ---------------------------------------------------------------------------
// Quote 26_Ala_QV1 — Veeam docuseries for ALAN, 27-Aug-2026.
// Every figure below is off the quote as it was sent.
// ---------------------------------------------------------------------------

// Every line carries the rate it actually went out at, which is what a saved
// quote holds. Deriving them again here would only be re-testing the rate card
// against costs the sheet prints to two decimals and stores to more.
const PRE: QuoteLine[] = [
  { costPence: p(486.28), ratePence: p(585), pax: 1, unitAmount: 2 }, // Producer
  { costPence: p(349.12), ratePence: p(420), pax: 1, unitAmount: 2 }, // Production Manager
  { costPence: p(498.75), ratePence: p(600), pax: 1, unitAmount: 4 }, // Director - Prep Day
  { costPence: p(299.25), ratePence: p(360), pax: 2, unitAmount: 1 }, // Location Scout
  { costPence: p(29.09), ratePence: p(35), pax: 2, unitAmount: 1 }, // Per Diems
  { costPence: p(50), ratePence: p(65), pax: 2, unitAmount: 1 }, // Fares
];

const PRODUCTION: QuoteLine[] = [
  { costPence: p(540.31), ratePence: p(650), pax: 1, unitAmount: 3 }, // Director - Shoot
  { costPence: p(486.28), ratePence: p(585), pax: 1, unitAmount: 3 }, // Producer - Shoot
  { costPence: p(457.19), ratePence: p(550), pax: 1, unitAmount: 3 }, // DoP
  { costPence: p(399.0), ratePence: p(480), pax: 1, unitAmount: 3 }, // Camera Op
  { costPence: p(349.13), ratePence: p(425), pax: 1, unitAmount: 3 }, // Camera Assistant
  { costPence: p(644.22), ratePence: p(775), pax: 1, unitAmount: 3 }, // Sound Op (with kit)
  { costPence: p(399.0), ratePence: p(480), pax: 1, unitAmount: 3 }, // Hair & Make-Up
];

const EQUIPMENT: QuoteLine[] = [
  { costPence: p(224.44), ratePence: p(270), pax: 2, unitAmount: 3 }, // Sony FX9 Camera Kit
  { costPence: p(199.5), ratePence: p(240), pax: 1, unitAmount: 3 }, // Gimbal Kit
  { costPence: p(249.38), ratePence: p(305), pax: 1, unitAmount: 3 }, // Large Interview Lighting
  { costPence: p(270.16), ratePence: p(330), pax: 1, unitAmount: 3 }, // Prime Lens Kit
  { costPence: p(124.0), ratePence: p(150), pax: 1, unitAmount: 3 }, // Slider
  { costPence: p(187.03), ratePence: p(225), pax: 1, unitAmount: 3 }, // EyeDirect
  { costPence: p(124.69), ratePence: p(155), pax: 1, unitAmount: 3 }, // Monitor
];

/**
 * The client-facing figure is asserted to the penny, because that is the
 * number that went out. The cost is allowed a few pence of slack: the sheet
 * shows costs to two decimals and holds more, so summing the displayed ones
 * cannot land exactly on its displayed total.
 */
function expectCategory(
  lines: QuoteLine[],
  expected: { cost: number; total: number }
) {
  const totals = categoryTotals(lines, VEEAM);
  expect(totals.total).toBe(p(expected.total));
  expect(Math.abs(totals.cost - p(expected.cost))).toBeLessThanOrEqual(5);
}

test("pre-production comes to what the client was quoted", () => {
  expectCategory(PRE, { cost: 4422.48, total: 5330 });
});

test("production comes to what the client was quoted", () => {
  expectCategory(PRODUCTION, { cost: 9825.39, total: 11835 });
});

test("equipment comes to what the client was quoted", () => {
  expectCategory(EQUIPMENT, { cost: 4810.89, total: 5835 });
});

// The internal sheet splits each category into the margins it carries. The
// round-up lands in contingency, which is the line that exists to absorb it.
test("the margin split matches the internal breakdown", () => {
  const totals = categoryTotals(PRE, VEEAM);
  expect(totals.profit).toBe(p(442.25));
  expect(totals.insurance).toBe(p(13.27));
  expect(totals.contingency).toBe(p(452));
  // The sheet prints £9.76 because it subtracts a contingency it has already
  // truncated for display. £9.75 is what the exact figures give.
  expect(totals.roundUp).toBe(p(9.75));
  // And the parts add back up to the whole.
  expect(totals.cost + totals.contingency + totals.profit + totals.insurance).toBe(
    totals.total
  );
});

// Post production is the interesting one: £21,800 of stock licensing passes
// through at cost, so the category is overridden down and the contingency
// goes negative. The sheet shows -£1,282.57.
test("a category carrying a big pass-through shows negative contingency", () => {
  const post: QuoteLine[] = [
    { costPence: p(415.63), ratePence: p(500), pax: 1, unitAmount: 10 }, // Offline Editor
    { costPence: p(415.63), ratePence: p(500), pax: 1, unitAmount: 5 }, // Amends
    { costPence: p(415.63), ratePence: p(500), pax: 1, unitAmount: 5 }, // Versioning
    { costPence: p(303.41), ratePence: p(365), pax: 1, unitAmount: 3 }, // Edit Assistant
    { costPence: p(16.63), ratePence: p(20), pax: 1, unitAmount: 10 }, // Library Music
    { costPence: p(21800), ratePence: p(21800), pax: 1, unitAmount: 1 }, // Stock
    { costPence: p(150), ratePence: p(150), pax: 1, unitAmount: 1 }, // Archiving
  ];
  const totals = categoryTotals(post, VEEAM);
  expect(totals.total).toBe(p(33245));
  expect(totals.contingency).toBeLessThan(0);
  expect(totals.cost + totals.contingency + totals.profit + totals.insurance).toBe(
    totals.total
  );
});

test("the whole quote lands on the figure that went out, VAT and all", () => {
  const categories = [
    categoryTotals(PRE, VEEAM),
    categoryTotals(PRODUCTION, VEEAM),
    categoryTotals(EQUIPMENT, VEEAM),
    // Travel and post are overridden to the figures on the sheet.
    categoryTotals([], VEEAM, { overrideTotal: p(3765) }),
    categoryTotals([], VEEAM, { overrideTotal: p(33245) }),
  ];
  const totals = quoteTotals(categories, { discountPence: 0, vatBp: 2000 });

  expect(totals.subtotal).toBe(p(60010));
  expect(totals.netTotal).toBe(p(60010));
  expect(totals.grossTotal).toBe(p(72012));
});

test("a discount comes off before VAT is worked out", () => {
  const categories = [categoryTotals([], VEEAM, { overrideTotal: p(60010) })];
  const totals = quoteTotals(categories, { discountPence: p(10), vatBp: 2000 });
  expect(totals.netTotal).toBe(p(60000));
  expect(totals.vat).toBe(p(12000));
  expect(totals.grossTotal).toBe(p(72000));
});

describe("where a category stands once the money is spent", () => {
  test("under budget leaves contingency and shows a profit", () => {
    const quoted = categoryTotals(PRE, VEEAM);
    const v = categoryVariance(quoted, p(4000));
    expect(v.variance).toBe(p(1330));
    expect(v.profitOrLoss).toBeGreaterThan(0);
    expect(v.contingencyLeft).toBe(quoted.contingency);
  });

  test("overspending eats the contingency before it eats the profit", () => {
    const quoted = categoryTotals(PRE, VEEAM);
    const v = categoryVariance(quoted, p(4600));
    expect(v.contingencyLeft).toBeLessThan(quoted.contingency);
    expect(v.profitOrLoss).toBeGreaterThan(0);
  });

  test("spending more than was quoted is a loss", () => {
    const quoted = categoryTotals(PRE, VEEAM);
    expect(categoryVariance(quoted, p(6000)).profitOrLoss).toBeLessThan(0);
  });
});

test("figures read the way they are written on a quote", () => {
  expect(formatPence(p(1170))).toBe("£1,170.00");
  expect(formatPence(p(60010))).toBe("£60,010.00");
  expect(formatPence(p(-1282.57))).toBe("-£1,282.57");
});
