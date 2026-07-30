/**
 * CATEGORY C — a season boundary falling mid-billing-period.
 *
 * May 20 - Jun 20 2026 straddles the June 1 summer boundary: 12 winter days then
 * 19 summer days. The split happens at LOCAL midnight, and both `measuredOver`
 * readings for demand are exercised, because which one SCE uses is a data
 * question that has not been answered yet.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flat, period } from './helpers/profile.js';
import { demandLine, describeBill, energyKwh, expectLinesSumToTotal, only } from './helpers/lines.js';

const START = '2026-05-20';
const END = '2026-06-20';

// May 20 (Wed) - May 31: 8 weekdays + 4 weekend days = 12 days, 1152 quarter-hours
// Jun 1 (Mon) - Jun 19: 15 weekdays + 4 weekend days = 19 days, 1824 quarter-hours
// 31 days, no DST transition, 2976 quarter-hours at 1 kWh.
const profile = buildProfile({ start: START, end: END, kwh: flat(1) });

describe('C9: the boundary splits energy at local midnight', () => {
  // winter mid-peak  8 wd x 5 h x 4 =  160 kWh @ 0.15 =  24.00
  // winter off-peak  1152 - 160     =  992 kWh @ 0.08 =  79.36
  // summer on-peak  15 wd x 5 h x 4 =  300 kWh @ 0.30 =  90.00
  // summer mid-peak  4 we x 5 h x 4 =   80 kWh @ 0.20 =  16.00
  // summer off-peak 1824 - 380      = 1444 kWh @ 0.10 = 144.40
  // facilities (whole period) 4 kW @ 20              =  80.00
  // summer on-peak demand     4 kW @ 12              =  48.00
  // customer charge                                  = 100.00
  //                                            total   581.76
  const bill = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());

  it('reports the two season segments with their day counts', () => {
    expect(bill.diagnostics.seasonSegments).toEqual([
      { seasonId: 'winter', startDate: '2026-05-20', endDate: '2026-05-31', days: 12 },
      { seasonId: 'summer', startDate: '2026-06-01', endDate: '2026-06-19', days: 19 },
    ]);
    expect(bill.billingPeriod.days).toBe(31);
    expect(bill.billingPeriod.hours).toBe(744);
  });

  it('classifies May 31 as winter and June 1 as summer', () => {
    expect(bill.diagnostics.days.find((d) => d.date === '2026-05-31')?.seasonId).toBe('winter');
    expect(bill.diagnostics.days.find((d) => d.date === '2026-06-01')?.seasonId).toBe('summer');
  });

  it('buckets each season to hand-computed kWh totals', () => {
    expect(energyKwh(bill, 'winter', 'mid-peak')).toBeCloseTo(160, 9);
    expect(energyKwh(bill, 'winter', 'off-peak')).toBeCloseTo(992, 9);
    expect(energyKwh(bill, 'summer', 'on-peak')).toBeCloseTo(300, 9);
    expect(energyKwh(bill, 'summer', 'mid-peak')).toBeCloseTo(80, 9);
    expect(energyKwh(bill, 'summer', 'off-peak')).toBeCloseTo(1444, 9);
    expect(bill.diagnostics.totalKwh).toBeCloseTo(2976, 9);
  });

  it('never bills winter usage at a summer rate', () => {
    // A summer energy line must not exist for a winter season id, and the winter
    // portion must be priced below the summer portion per kWh.
    expect(bill.lines.filter((l) => l.chargeType === 'energy' && l.seasonId === 'winter')).toHaveLength(2);
    expect(bill.lines.filter((l) => l.chargeType === 'energy' && l.seasonId === 'summer')).toHaveLength(3);
  });

  it('totals 581.76', () => {
    expect(bill.total, describeBill(bill)).toBe(581.76);
    expectLinesSumToTotal(bill);
  });
});

describe('C12: measuredOver decides whether demand is one maximum or one per season', () => {
  it('bills a single facilities maximum across the whole period', () => {
    const bill = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());
    const line = demandLine(bill, 'frd');
    expect(line.quantity).toBeCloseTo(4, 9);
    expect(line.amount).toBe(80);
    expect(bill.diagnostics.demandDeterminations.filter((d) => d.chargeId === 'frd')).toHaveLength(1);
  });

  it('bills a separate facilities maximum per season segment', () => {
    const base = makeSyntheticTariff();
    const tariff = makeSyntheticTariff({
      demandCharges: {
        ...base.demandCharges,
        facilities: [{ ...base.demandCharges.facilities[0]!, measuredOver: 'season-segment' }],
      },
    });
    const bill = rate(profile, tariff, period(START, END), emptyContext());

    const determinations = bill.diagnostics.demandDeterminations.filter((d) => d.chargeId === 'frd');
    expect(determinations).toHaveLength(2);
    expect(determinations.map((d) => d.seasonId)).toEqual(['winter', 'summer']);

    // Two lines, one per segment, each 4 kW at $20 — so the same flat load costs
    // twice as much in facilities demand under this reading.
    const lines = bill.lines.filter((l) => l.sourceId === 'frd');
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.amount === 80)).toBe(true);
    expect(bill.total).toBeCloseTo(581.76 + 80, 9);
  });

  it('restricts a season-bound facilities charge to that season only', () => {
    const base = makeSyntheticTariff();
    const tariff = makeSyntheticTariff({
      demandCharges: {
        ...base.demandCharges,
        facilities: [{ ...base.demandCharges.facilities[0]!, seasonId: 'summer' }],
      },
    });
    const bill = rate(profile, tariff, period(START, END), emptyContext());
    const line = demandLine(bill, 'frd');

    expect(line.seasonId).toBe('summer');
    // The peak must come from a June window, not a May one.
    const determination = only(bill.lines, (l) => l.sourceId === 'frd');
    expect(determination.quantity).toBeCloseTo(4, 9);
    const peak = bill.diagnostics.demandDeterminations.find((d) => d.chargeId === 'frd')?.peakWindowStartLocal;
    expect(peak?.slice(0, 7)).toBe('2026-06');
  });
});

describe('C10: a wrapping season resolves in January', () => {
  it('rates a mid-January period as winter', () => {
    const januaryProfile = buildProfile({ start: '2027-01-10', end: '2027-01-17', kwh: flat(1) });
    const bill = rate(januaryProfile, makeSyntheticTariff(), period('2027-01-10', '2027-01-17'), emptyContext());

    expect(bill.diagnostics.seasonSegments).toEqual([
      { seasonId: 'winter', startDate: '2027-01-10', endDate: '2027-01-16', days: 7 },
    ]);
    expect(bill.diagnostics.days.every((d) => d.seasonId === 'winter')).toBe(true);
    expect(energyKwh(bill, 'summer', 'on-peak')).toBe(0);
  });
});
