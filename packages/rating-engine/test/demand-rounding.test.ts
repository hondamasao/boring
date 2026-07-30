/**
 * Billing demand rounds to the nearest whole kW BEFORE the rate is applied — it
 * is not the dollar amount that gets rounded, the kW quantity itself is.
 *
 * Found reading SCE Schedule TOU-GS-2, Special Condition 6: "The Billing Demand
 * shall be the kW of Maximum Demand, determined to the nearest kW." Before this
 * fix, the engine only rounded the resulting dollar amount to cents, so a 47.6 kW
 * peak at $20/kW billed as 47.6 x 20 = $952.00 instead of the correct
 * round(47.6) x 20 = 48 x 20 = $960.00 — an $8.00 discrepancy against a real
 * bill, not a rounding-error-sized one.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flatWithSpikes, period } from './helpers/profile.js';
import { demandLine, describeBill, determination, expectLinesSumToTotal } from './helpers/lines.js';

const START = '2026-07-06'; // Monday
const END = '2026-07-11';

/** A single 15-minute spike averaging exactly `kw` for that window, everything
 * else at a low flat baseline so it never competes for the peak. */
function spikeProfile(atLocalIso: string, kw: number) {
  return buildProfile({ start: START, end: END, kwh: flatWithSpikes(1, { [atLocalIso]: kw * 0.25 }) });
}

// 3am is off-peak in the synthetic tariff, so the spike drives the facilities
// (any-time) peak without touching the on-peak time-related charge.
const SPIKE_AT = '2026-07-07T03:00:00-07:00';

describe('rounds up to the nearest whole kW', () => {
  // 47.6 kW rounds to 48. At $20/kW that is $960.00, not 47.6 x 20 = $952.00.
  const bill = rate(spikeProfile(SPIKE_AT, 47.6), makeSyntheticTariff(), period(START, END), emptyContext());
  const line = demandLine(bill, 'frd');

  it('bills the rounded quantity, not the raw one', () => {
    expect(line.quantity).toBe(48);
    expect(line.rate).toBe(20);
    expect(line.amount, describeBill(bill)).toBe(960);
  });

  it('would have billed 952.00 under the old (buggy) behavior — confirms this is not a no-op case', () => {
    expect(line.amount).not.toBe(952);
  });

  it('keeps the raw meter reading visible in diagnostics, unrounded', () => {
    // Special Condition 5's "Maximum Demand" is the raw reading; Special
    // Condition 6's "Billing Demand" is the rounded one. Both should be visible,
    // distinctly, so an audit can see what was measured vs. what was billed.
    const d = determination(bill, 'frd');
    expect(d.measuredPeakKw).toBeCloseTo(47.6, 9);
    expect(d.billedKw).toBe(48);
  });
});

describe('rounds down to the nearest whole kW', () => {
  // 47.4 kW rounds to 47, not 48 — confirms this isn't "always round up."
  const bill = rate(spikeProfile(SPIKE_AT, 47.4), makeSyntheticTariff(), period(START, END), emptyContext());
  const line = demandLine(bill, 'frd');

  it('bills 47 kW', () => {
    expect(line.quantity).toBe(47);
    expect(line.amount, describeBill(bill)).toBe(940);
  });
});

describe('an exact half rounds up, symmetric with money rounding', () => {
  const bill = rate(spikeProfile(SPIKE_AT, 47.5), makeSyntheticTariff(), period(START, END), emptyContext());
  const line = demandLine(bill, 'frd');

  it('bills 48 kW', () => {
    expect(line.quantity).toBe(48);
  });
});

describe('a whole-number peak is unaffected', () => {
  const bill = rate(spikeProfile(SPIKE_AT, 50), makeSyntheticTariff(), period(START, END), emptyContext());

  it('bills exactly 50 kW', () => {
    expect(demandLine(bill, 'frd').quantity).toBe(50);
    expectLinesSumToTotal(bill);
  });
});

describe('rounding applies to a time-related demand charge too, not just facilities', () => {
  // 4pm-9pm summer weekday on-peak. 23.5 kWh in one quarter-hour is 94 kW.
  const onPeakAt = '2026-07-07T17:00:00-07:00';
  const bill = rate(
    buildProfile({ start: START, end: END, kwh: flatWithSpikes(1, { [onPeakAt]: 23.5 }) }),
    makeSyntheticTariff(),
    period(START, END),
    emptyContext(),
  );
  const line = demandLine(bill, 'trd-summer-on-peak');

  it('rounds 94 kW exactly (already whole) and a fractional companion case rounds too', () => {
    expect(line.quantity).toBe(94);

    const fractional = rate(
      buildProfile({ start: START, end: END, kwh: flatWithSpikes(1, { [onPeakAt]: 23.65 }) }), // 94.6 kW
      makeSyntheticTariff(),
      period(START, END),
      emptyContext(),
    );
    expect(demandLine(fractional, 'trd-summer-on-peak').quantity).toBe(95);
  });
});

describe('rounding applies after a ratchet floor, not instead of it', () => {
  it('rounds a fractional ratchet-derived floor', () => {
    const tariff = makeSyntheticTariff({
      ratchets: [
        {
          id: 'frd-ratchet',
          label: 'test ratchet',
          appliesTo: { kind: 'facilities', chargeId: 'frd' },
          lookbackMonths: 11,
          percentOfPriorPeak: 0.5,
          seasonScope: 'any-season',
          citation: 'test',
        },
      ],
    });
    // 95 kW prior peak x 50% = 47.5 kW floor, against a 4 kW measured peak this
    // period — the floor wins, and 47.5 rounds to 48.
    const profile = buildProfile({ start: START, end: END, kwh: () => 1 });
    const bill = rate(
      profile,
      tariff,
      period(START, END),
      emptyContext({ demandHistory: { entries: [{ month: '2026-06', seasonId: 'summer', facilitiesPeakKw: 95, timeRelatedPeaksKw: {} }] } }),
    );

    const d = determination(bill, 'frd');
    expect(d.ratchetApplied?.floorKw).toBeCloseTo(47.5, 9);
    expect(d.billedKw).toBe(48);
    expect(demandLine(bill, 'frd').amount).toBe(960);
  });
});
