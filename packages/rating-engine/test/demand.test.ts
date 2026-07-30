/**
 * CATEGORY D — facilities vs time-related demand from the SAME load profile.
 *
 * This is the test that justifies modelling the two families as distinct types.
 * One profile carries a 500 kW spike at 2 a.m. (off-peak) and a 300 kW spike at
 * 5 p.m. (on-peak). A facilities charge must see 500; an on-peak time-related
 * charge must see 300. Any implementation that shares one "maximum demand" number
 * between them gets one of the two wrong.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import { makeSyntheticTariff } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flatWithSpikes, period } from './helpers/profile.js';
import { demandLine, describeBill, determination, energyKwh, expectLinesSumToTotal } from './helpers/lines.js';

// Mon July 6 - Fri July 10 2026: five summer weekdays, 480 quarter-hours.
const START = '2026-07-06';
const END = '2026-07-11';

// A 15-minute interval holding 125 kWh averages 500 kW; one holding 75 kWh
// averages 300 kW.
const OFF_PEAK_SPIKE = '2026-07-07T02:00:00-07:00';
const ON_PEAK_SPIKE = '2026-07-08T17:00:00-07:00';

const profile = buildProfile({
  start: START,
  end: END,
  kwh: flatWithSpikes(1, { [OFF_PEAK_SPIKE]: 125, [ON_PEAK_SPIKE]: 75 }),
});

describe('D13: one profile, two different maxima', () => {
  // on-peak  99 x 1 + 75 = 174 kWh @ 0.30 =    52.20
  // off-peak 379 x 1 + 125 = 504 kWh @ 0.10 =    50.40
  // facilities        500 kW @ 20 = 10,000.00
  // on-peak demand    300 kW @ 12 =  3,600.00
  // customer charge                  100.00
  //                          total 13,802.60
  const bill = rate(profile, makeSyntheticTariff(), period(START, END), emptyContext());

  it('bills the facilities charge off the 2 a.m. spike', () => {
    const line = demandLine(bill, 'frd');
    expect(line.chargeType).toBe('facilities-demand');
    expect(line.quantity).toBeCloseTo(500, 9);
    expect(line.rate).toBe(20);
    expect(line.amount).toBe(10000);
    expect(line.periodId).toBeUndefined();
  });

  it('bills the time-related charge off the 5 p.m. spike, ignoring the bigger one', () => {
    const line = demandLine(bill, 'trd-summer-on-peak');
    expect(line.chargeType).toBe('time-related-demand');
    expect(line.quantity).toBeCloseTo(300, 9);
    expect(line.rate).toBe(12);
    expect(line.amount).toBe(3600);
    expect(line.periodId).toBe('on-peak');
  });

  it('reports where each peak came from, in local time', () => {
    expect(determination(bill, 'frd')).toMatchObject({
      kind: 'facilities',
      periodId: null,
      measuredPeakKw: 500,
      billedKw: 500,
      peakWindowStartLocal: OFF_PEAK_SPIKE,
      ratchetApplied: null,
    });
    expect(determination(bill, 'trd-summer-on-peak')).toMatchObject({
      kind: 'time-related',
      periodId: 'on-peak',
      measuredPeakKw: 300,
      billedKw: 300,
      peakWindowStartLocal: ON_PEAK_SPIKE,
    });
  });

  it('records the account maximum independently of any charge', () => {
    // Eligibility rules need this whether or not the schedule has a facilities
    // charge, so it is computed unconditionally.
    expect(bill.diagnostics.accountMaxDemandKw).toBeCloseTo(500, 9);
    expect(bill.diagnostics.accountMaxDemandAtLocal).toBe(OFF_PEAK_SPIKE);
  });

  it('still bills every spiked kWh as energy', () => {
    expect(energyKwh(bill, 'summer', 'on-peak')).toBeCloseTo(174, 9);
    expect(energyKwh(bill, 'summer', 'off-peak')).toBeCloseTo(504, 9);
    expect(bill.diagnostics.totalKwh).toBeCloseTo(678, 9);
  });

  it('totals 13,802.60', () => {
    expect(bill.total, describeBill(bill)).toBe(13802.6);
    expectLinesSumToTotal(bill);
  });
});

describe('D: the demand window is tariff data', () => {
  it('averages finer intervals up to the 15-minute window', () => {
    // Five-minute data with a single 5-minute burst. 125/3 kWh in five minutes is
    // 500 kW instantaneous, but the 15-minute window [02:00, 02:15) holds three
    // 5-minute intervals — the burst plus two at 1/3 kWh — so the metered average
    // is (125/3 + 1/3 + 1/3) / 0.25 h = 508/3 = 169.33 kW.
    //
    // Averaging up to the window, rather than taking the finest peak available, is
    // what the 15-minute definition means. Reporting 500 kW here would overstate
    // the customer's demand charge by a factor of three.
    const fiveMinute = buildProfile({
      start: START,
      end: END,
      intervalMinutes: 5,
      kwh: flatWithSpikes(1 / 3, { '2026-07-07T02:00:00-07:00': 125 / 3 }),
    });
    const bill = rate(fiveMinute, makeSyntheticTariff(), period(START, END), emptyContext());

    expect(bill.diagnostics.demandWindowMinutes).toBe(15);
    expect(bill.diagnostics.accountMaxDemandKw).toBeCloseTo(508 / 3, 6);
    expect(bill.warnings.filter((w) => w.includes('coarser'))).toHaveLength(0);
  });

  it('honours an account-level 5-minute override, finding the real burst', () => {
    // SCE uses a 5-minute interval where load is intermittent or subject to
    // violent fluctuation. That is a determination about the ACCOUNT, so it
    // arrives on serviceAttributes rather than in the tariff record.
    const fiveMinute = buildProfile({
      start: START,
      end: END,
      intervalMinutes: 5,
      kwh: flatWithSpikes(1 / 3, { '2026-07-07T02:00:00-07:00': 125 / 3 }),
    });
    const bill = rate(
      fiveMinute,
      makeSyntheticTariff(),
      period(START, END),
      emptyContext({ serviceAttributes: { demandWindowMinutesOverride: 5 } }),
    );

    expect(bill.diagnostics.demandWindowMinutes).toBe(5);
    expect(bill.diagnostics.accountMaxDemandKw).toBeCloseTo(500, 6);
    // The same profile bills far more demand under the 5-minute determination.
    expect(demandLine(bill, 'frd').amount).toBeCloseTo(10000, 2);
  });

  it('warns rather than silently understating when the data is coarser than the window', () => {
    const hourly = buildProfile({ start: START, end: END, intervalMinutes: 60, kwh: () => 4 });
    const bill = rate(hourly, makeSyntheticTariff(), period(START, END), emptyContext());

    expect(bill.warnings.some((w) => w.includes('coarser') && w.includes('understate'))).toBe(true);
    // It still rates, using the interval it has.
    expect(bill.diagnostics.accountMaxDemandKw).toBeCloseTo(4, 9);
  });
});

describe('D: a facilities-only schedule', () => {
  it('bills no time-related demand when the option carries none', () => {
    const base = makeSyntheticTariff();
    const tariff = makeSyntheticTariff({
      demandCharges: { facilities: base.demandCharges.facilities, timeRelated: [] },
    });
    const bill = rate(profile, tariff, period(START, END), emptyContext());

    expect(bill.lines.filter((l) => l.chargeType === 'time-related-demand')).toHaveLength(0);
    expect(demandLine(bill, 'frd').quantity).toBeCloseTo(500, 9);
    // 13,802.60 less the 3,600.00 of on-peak demand.
    expect(bill.total).toBe(10202.6);
  });
});

describe('D: power factor', () => {
  it('bills reactive demand in excess of the threshold power factor', () => {
    // At a 0.85 threshold, a 4 kW real demand is allowed
    //   4 x tan(acos(0.85)) = 4 x 0.619775 = 2.479 kVAR.
    // A flat 0.5 kvarh per quarter-hour is 2 kVAR, which is under the allowance,
    // so a profile at 2 kVAR must attract nothing.
    const tariff = makeSyntheticTariff({
      powerFactorAdjustment: {
        id: 'pf-adjustment',
        label: 'Power Factor Adjustment',
        component: 'delivery',
        method: 'per-kvar-below-threshold',
        thresholdPowerFactor: 0.85,
        ratePerKvar: 1,
        citation: 'synthetic',
      },
    });

    const underThreshold = rate(
      buildProfile({ start: START, end: END, kwh: () => 1, kvarh: () => 0.5 }),
      tariff,
      period(START, END),
      emptyContext(),
    );
    expect(underThreshold.lines.filter((l) => l.chargeType === 'power-factor-adjustment')).toHaveLength(1);
    expect(demandLine(underThreshold, 'pf-adjustment').amount).toBe(0);

    // 2 kvarh per quarter-hour is 8 kVAR against an allowance of 2.479, so
    // 5.521 kVAR is billable at $1.
    const overThreshold = rate(
      buildProfile({ start: START, end: END, kwh: () => 1, kvarh: () => 2 }),
      tariff,
      period(START, END),
      emptyContext(),
    );
    const line = demandLine(overThreshold, 'pf-adjustment');
    expect(line.quantity).toBeCloseTo(8 - 4 * Math.tan(Math.acos(0.85)), 6);
    expect(line.amount).toBeCloseTo(5.52, 2);
  });

  it('warns when a power factor clause has no reactive data to work with', () => {
    const tariff = makeSyntheticTariff({
      powerFactorAdjustment: {
        id: 'pf-adjustment',
        label: 'Power Factor Adjustment',
        component: 'delivery',
        method: 'per-kvar-below-threshold',
        thresholdPowerFactor: 0.85,
        ratePerKvar: 1,
        citation: 'synthetic',
      },
    });
    const bill = rate(profile, tariff, period(START, END), emptyContext());
    expect(bill.warnings.some((w) => w.toLowerCase().includes('kvarh'))).toBe(true);
  });
});
