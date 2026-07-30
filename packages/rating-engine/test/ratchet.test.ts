/**
 * CATEGORY E — a ratchet where a prior month's peak dominates the current month.
 *
 * Prior peaks arrive as an explicit argument (`demandHistory`), never a lookup.
 * Every parameter is data, so both season scopes and the lookback boundary are
 * exercised here rather than assumed.
 *
 * Whether SCE's TOU-GS-2 actually HAS a ratchet is unverified — see
 * packages/tariff-library/PENDING.md. These tests drive the machinery from a
 * synthetic tariff so the mechanism is correct whichever way that lands.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import type { DemandHistory, DemandRatchet, Tariff } from '@boring/tariff-schema';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flat, period } from './helpers/profile.js';
import { demandLine, describeBill, determination, expectLinesSumToTotal } from './helpers/lines.js';

// Five summer weekdays, flat 1 kWh per quarter-hour: 480 kWh and a measured
// maximum demand of 4 kW. Everything except the facilities line is constant:
//   on-peak  100 kWh @ 0.30 =  30.00
//   off-peak 380 kWh @ 0.10 =  38.00
//   on-peak demand 4 kW @ 12 = 48.00
//   customer charge          = 100.00   -> 216.00 before facilities demand
const START = '2026-07-06';
const END = '2026-07-11';
const CONSTANT_PART = 216;

const profile = buildProfile({ start: START, end: END, kwh: flat(1) });

const facilitiesRatchet: DemandRatchet = {
  id: 'frd-ratchet',
  label: '50% of the highest demand in the preceding eleven months',
  appliesTo: { kind: 'facilities', chargeId: 'frd' },
  lookbackMonths: 11,
  percentOfPriorPeak: 0.5,
  seasonScope: 'any-season',
  citation: 'synthetic',
};

function tariffWith(ratchets: DemandRatchet[], seasonSegmented = false): Tariff {
  const base = makeSyntheticTariff();
  return makeSyntheticTariff({
    ratchets,
    demandCharges: seasonSegmented
      ? {
          ...base.demandCharges,
          facilities: [{ ...base.demandCharges.facilities[0]!, measuredOver: 'season-segment' }],
        }
      : base.demandCharges,
  });
}

function history(entries: [month: string, peakKw: number, seasonId: string | null][]): DemandHistory {
  return {
    entries: entries.map(([month, facilitiesPeakKw, seasonId]) => ({
      month,
      seasonId,
      facilitiesPeakKw,
      timeRelatedPeaksKw: {},
    })),
  };
}

function bill(ratchets: DemandRatchet[], demandHistory: DemandHistory, seasonSegmented = false) {
  return rate(profile, tariffWith(ratchets, seasonSegmented), period(START, END), emptyContext({ demandHistory }));
}

describe('E16: a prior month dominates the current month', () => {
  // June peaked at 600 kW, so the floor is 300 kW against a measured 4 kW.
  // facilities 300 kW @ 20 = 6,000.00, total 6,216.00
  const result = bill([facilitiesRatchet], history([['2026-06', 600, 'summer']]));

  it('bills the floor, not the measured peak', () => {
    const line = demandLine(result, 'frd');
    expect(line.quantity).toBeCloseTo(300, 9);
    expect(line.amount).toBe(6000);
  });

  it('shows the measured peak alongside the billed one, and names the source month', () => {
    expect(determination(result, 'frd')).toMatchObject({
      measuredPeakKw: 4,
      billedKw: 300,
      ratchetApplied: {
        ratchetId: 'frd-ratchet',
        sourceMonth: '2026-06',
        priorPeakKw: 600,
        floorKw: 300,
      },
    });
  });

  it('says on the line itself that a ratchet set the quantity', () => {
    const line = demandLine(result, 'frd');
    expect(line.notes?.join(' ')).toContain('2026-06');
    expect(line.notes?.join(' ')).toContain('ratchet');
  });

  it('totals 6,216.00', () => {
    expect(result.total, describeBill(result)).toBe(CONSTANT_PART + 6000);
    expectLinesSumToTotal(result);
  });
});

describe('E17: no ratchet when the current month is above the floor', () => {
  const result = bill([facilitiesRatchet], history([['2026-06', 4, 'summer']]));

  it('bills the measured peak', () => {
    expect(demandLine(result, 'frd').quantity).toBeCloseTo(4, 9);
    expect(demandLine(result, 'frd').amount).toBe(80);
  });

  it('records no ratchet and adds no phantom line', () => {
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
    expect(result.lines.filter((l) => l.sourceId === 'frd')).toHaveLength(1);
    expect(demandLine(result, 'frd').notes ?? []).not.toContain(expect.stringContaining('ratchet'));
  });

  it('totals 296.00', () => {
    expect(result.total, describeBill(result)).toBe(CONSTANT_PART + 80);
  });
});

describe('E18: the lookback window has an edge', () => {
  it('ignores a peak one month beyond the window', () => {
    // Current month is 2026-07, so an 11-month lookback reaches 2025-08.
    const result = bill([facilitiesRatchet], history([['2025-07', 600, 'summer']]));
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
    expect(result.total).toBe(CONSTANT_PART + 80);
  });

  it('uses a peak at the far edge of the window', () => {
    const result = bill([facilitiesRatchet], history([['2025-08', 600, 'summer']]));
    expect(determination(result, 'frd').ratchetApplied).toMatchObject({ sourceMonth: '2025-08' });
    expect(result.total).toBe(CONSTANT_PART + 6000);
  });

  it('takes the highest qualifying month, not the most recent', () => {
    const result = bill(
      [facilitiesRatchet],
      history([
        ['2026-06', 400, 'summer'],
        ['2026-05', 600, 'winter'],
      ]),
    );
    expect(determination(result, 'frd').ratchetApplied).toMatchObject({
      sourceMonth: '2026-05',
      priorPeakKw: 600,
      floorKw: 300,
    });
  });

  it('excludes the month being billed from its own lookback', () => {
    // A history entry for the current month would otherwise let this month's own
    // peak floor itself, which is not what a ratchet means.
    const result = bill([facilitiesRatchet], history([['2026-07', 600, 'summer']]));
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
  });

  it('derives the current month from the last day in the period, not the exclusive end', () => {
    // July 6 - August 1 is a July bill. An August history entry must not count as
    // a prior month, and a July one must be excluded as the current month.
    const julyProfile = buildProfile({ start: START, end: '2026-08-01', kwh: flat(1) });
    const result = rate(
      julyProfile,
      tariffWith([facilitiesRatchet]),
      period(START, '2026-08-01'),
      emptyContext({ demandHistory: history([['2026-07', 600, 'summer']]) }),
    );
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
  });
});

describe('E19: season scope', () => {
  it('same-season-only ignores a peak from the other season', () => {
    const result = bill(
      [{ ...facilitiesRatchet, seasonScope: 'same-season-only' }],
      history([['2026-01', 600, 'winter']]),
      true,
    );
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
    expect(demandLine(result, 'frd').quantity).toBeCloseTo(4, 9);
  });

  it('same-season-only accepts a peak from the same season', () => {
    const result = bill(
      [{ ...facilitiesRatchet, seasonScope: 'same-season-only' }],
      history([['2026-06', 600, 'summer']]),
      true,
    );
    expect(determination(result, 'frd').ratchetApplied).toMatchObject({ sourceMonth: '2026-06' });
    expect(demandLine(result, 'frd').quantity).toBeCloseTo(300, 9);
  });

  it('any-season accepts a winter peak against a summer month', () => {
    const result = bill([facilitiesRatchet], history([['2026-01', 600, 'winter']]));
    expect(determination(result, 'frd').ratchetApplied).toMatchObject({ sourceMonth: '2026-01' });
  });

  it('skips a history entry whose season is unknown under same-season-only', () => {
    const result = bill(
      [{ ...facilitiesRatchet, seasonScope: 'same-season-only' }],
      history([['2026-06', 600, null]]),
      true,
    );
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
    expect(result.warnings.some((w) => w.includes('2026-06') && w.includes('season'))).toBe(true);
  });
});

describe('E: a ratchet on a time-related charge', () => {
  it('floors the on-peak demand from the prior on-peak peak, keyed by charge id', () => {
    const timeRelatedRatchet: DemandRatchet = {
      id: 'trd-ratchet',
      label: '50% of the highest on-peak demand in the preceding eleven months',
      appliesTo: { kind: 'time-related', chargeId: 'trd-summer-on-peak' },
      lookbackMonths: 11,
      percentOfPriorPeak: 0.5,
      seasonScope: 'any-season',
      citation: 'synthetic',
    };
    const result = rate(
      profile,
      tariffWith([timeRelatedRatchet]),
      period(START, END),
      emptyContext({
        demandHistory: {
          entries: [
            {
              month: '2026-06',
              seasonId: 'summer',
              facilitiesPeakKw: 600,
              timeRelatedPeaksKw: { 'trd-summer-on-peak': 200 },
            },
          ],
        },
      }),
    );

    // The time-related charge is floored at 100 kW; the facilities charge has no
    // ratchet of its own, so the 600 kW facilities history does not touch it.
    expect(demandLine(result, 'trd-summer-on-peak').quantity).toBeCloseTo(100, 9);
    expect(demandLine(result, 'trd-summer-on-peak').amount).toBe(1200);
    expect(demandLine(result, 'frd').quantity).toBeCloseTo(4, 9);
    expect(result.total, describeBill(result)).toBe(30 + 38 + 80 + 1200 + 100);
  });

  it('leaves the charge unfloored when history has no peak for that charge id', () => {
    const timeRelatedRatchet: DemandRatchet = {
      id: 'trd-ratchet',
      label: 'ratchet',
      appliesTo: { kind: 'time-related', chargeId: 'trd-summer-on-peak' },
      lookbackMonths: 11,
      percentOfPriorPeak: 0.5,
      seasonScope: 'any-season',
      citation: 'synthetic',
    };
    const result = rate(
      profile,
      tariffWith([timeRelatedRatchet]),
      period(START, END),
      emptyContext({ demandHistory: history([['2026-06', 600, 'summer']]) }),
    );
    expect(determination(result, 'trd-summer-on-peak').ratchetApplied).toBeNull();
  });
});

describe('E: an empty history is not an error', () => {
  it('rates a first-ever bill with no ratchet applied', () => {
    const result = bill([facilitiesRatchet], { entries: [] });
    expect(determination(result, 'frd').ratchetApplied).toBeNull();
    expect(result.total).toBe(CONSTANT_PART + 80);
    expect(result.warnings.some((w) => w.includes('no demand history'))).toBe(true);
  });
});
