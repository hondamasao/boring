/**
 * CATEGORY G — minimum bill logic.
 *
 * When the minimum bites, the engine adds a make-up LINE and leaves every earlier
 * line alone. A bill that rewrites its own itemization cannot be reconciled
 * against the real one, and the billing-error detector needs to see what the
 * charges would have been.
 *
 * All three forms are exercised, because which one TOU-GS-2 uses is unanswered.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { STAGE, type MinimumBill, type Rider, type Tariff } from '@boring/tariff-schema';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flat, period } from './helpers/profile.js';
import { describeBill, expectLinesSumToTotal, only, riderLine } from './helpers/lines.js';

// Five summer weekdays at a near-idle 0.01 kWh per quarter-hour:
//   on-peak     1.0 kWh @ 0.30 =   0.30
//   off-peak    3.8 kWh @ 0.10 =   0.38
//   facilities 0.04 kW, rounds to the nearest whole kW = 0 kW @ 20 =   0.00
//   on-peak demand 0.04 kW, rounds to 0 kW @ 12         =              0.00
//                                                          stage 0 =   0.68
//   customer charge                                       stage 1 = 100.00
//                                                    stages 0-3 = 100.68
//
// Demand rounds to zero here on purpose — an idle account should have $0 demand
// charges, and this is what "round to the nearest kW before billing" (Special
// Condition 6) actually does at the low end, not just the high end tested in
// demand-rounding.test.ts.
const START = '2026-07-06';
const END = '2026-07-11';
const idle = buildProfile({ start: START, end: END, kwh: flat(0.01) });
const BEFORE_MINIMUM = 100.68;

const cite = 'synthetic';
const allChargeStages = [0, 1, 2, 3];

function tariffWith(minimumBill: MinimumBill | null, riders: Rider[] = []): Tariff {
  return makeSyntheticTariff({ minimumBill, riders });
}

function bill(minimumBill: MinimumBill | null, riders: Rider[] = [], meterCount = 1) {
  return rate(idle, tariffWith(minimumBill, riders), period(START, END, meterCount), emptyContext());
}

const perDay = (amountPerDay: number, includeStages = allChargeStages): MinimumBill => ({
  kind: 'per-day',
  amountPerDay,
  perMeter: false,
  component: 'delivery',
  comparisonScope: { includeStages, components: null, excludeComponents: null },
  citation: cite,
});

describe('G23: a minimum that bites', () => {
  // $50/day x 5 days = $250.00 floor against a $100.68 bill.
  const result = bill(perDay(50));

  it('adds a make-up line for exactly the shortfall', () => {
    const adjustment = only(result.lines, (l) => l.chargeType === 'minimum-bill-adjustment');
    expect(adjustment.stage).toBe(STAGE.MINIMUM_BILL);
    expect(adjustment.amount).toBe(149.32);
    expect(adjustment.notes?.join(' ')).toContain('250');
  });

  it('leaves every earlier line untouched', () => {
    // The computed charges are still visible and still add up to what they were.
    expect(result.subtotals.cumulativeThroughStage['3']).toBe(BEFORE_MINIMUM);
    expect(only(result.lines, (l) => l.sourceId === 'customer-charge').amount).toBe(100);
    expect(only(result.lines, (l) => l.sourceId === 'frd').amount).toBe(0);
  });

  it('totals exactly the minimum', () => {
    expect(result.total, describeBill(result)).toBe(250);
    expectLinesSumToTotal(result);
  });
});

describe('G24: a minimum that does not bite', () => {
  const result = bill(perDay(10));

  it('adds no line at all, rather than a zero one', () => {
    expect(result.lines.filter((l) => l.chargeType === 'minimum-bill-adjustment')).toHaveLength(0);
    expect(result.subtotals.byStage['4']).toBe(0);
  });

  it('totals the computed charges', () => {
    expect(result.total, describeBill(result)).toBe(BEFORE_MINIMUM);
  });
});

describe('G25: whether a tax includes the make-up amount is a declared choice', () => {
  const tax = (includeStages: number[]): Rider => ({
    basis: 'percent-of-subtotal',
    id: 'uut',
    label: 'Utility Users Tax',
    component: 'taxes-and-fees',
    percent: 0.1,
    stage: 5,
    base: { includeStages, chargeTypes: null, components: null, excludeComponents: null },
    citation: cite,
  });

  it('taxes the make-up amount when stage 4 is in the base', () => {
    const result = bill(perDay(50), [tax([0, 1, 2, 3, 4])]);
    expect(riderLine(result, 'uut').quantity).toBe(250);
    expect(riderLine(result, 'uut').amount).toBe(25);
    expect(result.total, describeBill(result)).toBe(275);
  });

  it('excludes the make-up amount when stage 4 is left out', () => {
    const result = bill(perDay(50), [tax([0, 1, 2, 3])]);
    expect(riderLine(result, 'uut').quantity).toBe(BEFORE_MINIMUM);
    expect(riderLine(result, 'uut').amount).toBe(10.07);
    expect(result.total, describeBill(result)).toBe(260.07);
  });
});

describe('G: per-month and per-meter forms', () => {
  it('scales a per-month minimum by meter count when perMeter is set', () => {
    const minimum: MinimumBill = {
      kind: 'per-month',
      amountPerMonth: 100,
      perMeter: true,
      component: 'delivery',
      comparisonScope: { includeStages: allChargeStages, components: null, excludeComponents: null },
      citation: cite,
    };
    const result = bill(minimum, [], 3);
    expect(only(result.lines, (l) => l.chargeType === 'minimum-bill-adjustment').amount).toBe(199.32);
    expect(result.total).toBe(300);
  });

  it('scales a per-day minimum by meter count when perMeter is set', () => {
    const minimum: MinimumBill = { ...perDay(50), perMeter: true };
    // $50 x 5 days x 2 meters = $500.
    const result = bill(minimum, [], 2);
    expect(result.total).toBe(500);
  });
});

describe('G: the charge-floor form', () => {
  // "minimum charge: the customer charge plus the facilities-related demand
  // charge" -> 100.00 + 0.00 = 100.00 (the facilities peak rounds to 0 kW here).
  const chargeFloor = (includeStages: number[]): MinimumBill => ({
    kind: 'charge-floor',
    floorChargeIds: ['customer-charge', 'frd'],
    component: 'delivery',
    comparisonScope: { includeStages, components: null, excludeComponents: null },
    citation: cite,
  });

  it('computes the floor from the named charges and does not bite here', () => {
    const result = bill(chargeFloor([0, 1]));
    expect(result.lines.filter((l) => l.chargeType === 'minimum-bill-adjustment')).toHaveLength(0);
    expect(result.total).toBe(BEFORE_MINIMUM);
  });

  it('bites when the comparison is narrowed to the charges below the floor', () => {
    // Comparing only stage 0 (0.68) against a 100.00 floor.
    const result = bill(chargeFloor([0]));
    const adjustment = only(result.lines, (l) => l.chargeType === 'minimum-bill-adjustment');
    expect(adjustment.amount).toBe(99.32);
    expect(result.total, describeBill(result)).toBe(200);
  });
});

describe('G: the comparison scope can exclude components', () => {
  it('leaves generation out of the comparison when told to', () => {
    const minimum: MinimumBill = {
      ...perDay(21),
      comparisonScope: {
        includeStages: allChargeStages,
        components: null,
        excludeComponents: ['generation'],
      },
    };
    // $21/day x 5 = $105 floor against $100.68 -> a $4.32 shortfall.
    const result = bill(minimum);
    expect(only(result.lines, (l) => l.chargeType === 'minimum-bill-adjustment').amount).toBe(4.32);
    expect(result.total).toBe(105);
  });
});

describe('G: no minimum bill configured', () => {
  it('adds nothing and rates the charges as computed', () => {
    const result = bill(null);
    expect(result.lines.filter((l) => l.chargeType === 'minimum-bill-adjustment')).toHaveLength(0);
    expect(result.total).toBe(BEFORE_MINIMUM);
  });
});
