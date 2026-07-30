/**
 * CATEGORY A — DST and the local clock.
 *
 * Written before the engine existed. In 2026, America/Los_Angeles springs
 * forward on Sunday March 8 (a 23-hour local day, with no 02:xx) and falls back
 * on Sunday November 1 (a 25-hour local day, with two 01:xx hours).
 *
 * The expectations below are hand-computed from the synthetic tariff's rates, not
 * read off a previous run.
 */
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { rate } from '@boring/rating-engine';
import { buildProfile, emptyContext, flat, period, tariffWithWinterWeekendPeak, ZONE } from './helpers/profile.js';
import { demandLine, describeBill, energyKwh, energyLine, expectLinesSumToTotal } from './helpers/lines.js';

const SPRING_FORWARD = '2026-03-08';
const FALL_BACK = '2026-11-01';

describe('the profile builder itself produces the right number of intervals', () => {
  it('yields 92 quarter-hours on the 23-hour spring-forward day', () => {
    const profile = buildProfile({ start: SPRING_FORWARD, end: '2026-03-09', kwh: flat(2.5) });
    expect(profile.readings).toHaveLength(92);
    // The local clock skips 2 a.m. entirely.
    const localHours = profile.readings.map((r) => DateTime.fromISO(r.start, { zone: ZONE }).hour);
    expect(localHours).not.toContain(2);
    expect(localHours.filter((h) => h === 1)).toHaveLength(4);
    expect(localHours.filter((h) => h === 3)).toHaveLength(4);
  });

  it('yields 100 quarter-hours on the 25-hour fall-back day, with 1 a.m. twice', () => {
    const profile = buildProfile({ start: FALL_BACK, end: '2026-11-02', kwh: flat(2.5) });
    expect(profile.readings).toHaveLength(100);

    const oneAm = profile.readings.filter((r) => DateTime.fromISO(r.start, { zone: ZONE }).hour === 1);
    expect(oneAm).toHaveLength(8);
    // The two 1 a.m. hours are distinct instants, distinguished by offset.
    expect(oneAm.filter((r) => r.start.endsWith('-07:00'))).toHaveLength(4);
    expect(oneAm.filter((r) => r.start.endsWith('-08:00'))).toHaveLength(4);
    expect(new Set(oneAm.map((r) => r.start)).size).toBe(8);
  });
});

describe('A1: the spring-forward day has 23 hours', () => {
  // March 8 2026 is a Sunday in winter. With the winter-weekend peak variant:
  //   00:00-16:00 off-peak, but 2 a.m. does not exist -> 15 clock-hours
  //   16:00-21:00 mid-peak                            ->  5 clock-hours
  //   21:00-24:00 off-peak                            ->  3 clock-hours
  //                                                      23 total
  // At 2.5 kWh per quarter-hour = 10 kWh/hour:
  //   mid-peak  5 h x 10 = 50 kWh   @ 0.15 =  7.50
  //   off-peak 18 h x 10 = 180 kWh  @ 0.08 = 14.40
  //   facilities: every window averages 2.5 / 0.25 h = 10 kW  @ 20 = 200.00
  //   summer time-related demand: no summer hours in the period  =   0.00
  //   customer charge                                            = 100.00
  //                                                        total   321.90
  const bill = rate(
    buildProfile({ start: SPRING_FORWARD, end: '2026-03-09', kwh: flat(2.5) }),
    tariffWithWinterWeekendPeak(),
    period(SPRING_FORWARD, '2026-03-09'),
    emptyContext(),
  );

  it('counts one calendar day and 23 elapsed hours', () => {
    expect(bill.billingPeriod.days).toBe(1);
    expect(bill.billingPeriod.hours).toBe(23);
    expect(bill.diagnostics.days).toHaveLength(1);
    expect(bill.diagnostics.days[0]).toMatchObject({
      date: SPRING_FORWARD,
      seasonId: 'winter',
      dayType: 'sun',
      isHoliday: false,
      hours: 23,
    });
  });

  it('conserves kWh: every interval is bucketed exactly once', () => {
    expect(bill.diagnostics.totalKwh).toBeCloseTo(230, 9);
    expect(energyKwh(bill, 'winter', 'mid-peak') + energyKwh(bill, 'winter', 'off-peak')).toBeCloseTo(230, 9);
  });

  it('bills the missing hour out of off-peak, leaving the peak window intact', () => {
    expect(energyKwh(bill, 'winter', 'mid-peak')).toBeCloseTo(50, 9);
    expect(energyKwh(bill, 'winter', 'off-peak')).toBeCloseTo(180, 9);
    expect(energyLine(bill, 'winter', 'mid-peak').amount).toBe(7.5);
    expect(energyLine(bill, 'winter', 'off-peak').amount).toBe(14.4);
  });

  it('totals 321.90', () => {
    expect(bill.total, describeBill(bill)).toBe(321.9);
    expectLinesSumToTotal(bill);
  });

  it('still emits a zero-quantity line for a demand charge with no qualifying hours', () => {
    const line = demandLine(bill, 'trd-summer-on-peak');
    expect(line.quantity).toBe(0);
    expect(line.amount).toBe(0);
  });
});

describe('A2: the fall-back day has 25 hours', () => {
  // November 1 2026 is a Sunday in winter. The repeated 1 a.m. lands inside the
  // 00:00-16:00 off-peak block, so off-peak absorbs the extra hour:
  //   off-peak 17 + 3 = 20 clock-hours -> 200 kWh @ 0.08 = 16.00
  //   mid-peak  5 clock-hours          ->  50 kWh @ 0.15 =  7.50
  //   facilities 10 kW @ 20                              = 200.00
  //   customer charge                                    = 100.00
  //                                                total   323.50
  const bill = rate(
    buildProfile({ start: FALL_BACK, end: '2026-11-02', kwh: flat(2.5) }),
    tariffWithWinterWeekendPeak(),
    period(FALL_BACK, '2026-11-02'),
    emptyContext(),
  );

  it('counts one calendar day and 25 elapsed hours', () => {
    expect(bill.billingPeriod.days).toBe(1);
    expect(bill.billingPeriod.hours).toBe(25);
    expect(bill.diagnostics.days[0]?.hours).toBe(25);
  });

  it('counts both 1 a.m. hours, dropping neither and double-counting neither', () => {
    expect(bill.diagnostics.totalKwh).toBeCloseTo(250, 9);
    expect(energyKwh(bill, 'winter', 'off-peak')).toBeCloseTo(200, 9);
  });

  it('leaves the peak window at five clock-hours', () => {
    expect(energyKwh(bill, 'winter', 'mid-peak')).toBeCloseTo(50, 9);
  });

  it('totals 323.50', () => {
    expect(bill.total, describeBill(bill)).toBe(323.5);
    expectLinesSumToTotal(bill);
  });
});

describe('A5: the peak window is five clock-hours on both transition days', () => {
  it('bills identical mid-peak kWh on a 23-hour and a 25-hour day', () => {
    const tariff = tariffWithWinterWeekendPeak();
    const spring = rate(
      buildProfile({ start: SPRING_FORWARD, end: '2026-03-09', kwh: flat(2.5) }),
      tariff,
      period(SPRING_FORWARD, '2026-03-09'),
      emptyContext(),
    );
    const fall = rate(
      buildProfile({ start: FALL_BACK, end: '2026-11-02', kwh: flat(2.5) }),
      tariff,
      period(FALL_BACK, '2026-11-02'),
      emptyContext(),
    );

    // This is the whole point: the TOU window is defined in local clock time, so
    // it is unmoved by a transition, while the day's total length is not.
    expect(energyKwh(spring, 'winter', 'mid-peak')).toBeCloseTo(50, 9);
    expect(energyKwh(fall, 'winter', 'mid-peak')).toBeCloseTo(50, 9);
    expect(spring.billingPeriod.hours).toBe(23);
    expect(fall.billingPeriod.hours).toBe(25);
    expect(fall.diagnostics.totalKwh - spring.diagnostics.totalKwh).toBeCloseTo(20, 9);
  });
});

describe('A3: a billing period spanning spring-forward', () => {
  // Feb 20 - Mar 20 2026, half-open. 9 days in February + 19 in March = 28 days,
  // 28 x 24 - 1 = 671 hours, 2684 quarter-hours.
  //
  // This fixture gives EVERY day a 16:00-21:00 mid-peak window, weekends
  // included, so mid-peak is 5 clock-hours x 28 days with no weekday counting to
  // get wrong. That isolates the thing under test: the lost hour is at 2 a.m.,
  // inside the off-peak block, so off-peak absorbs it and mid-peak is untouched.
  //
  // mid-peak  28 d x 5 h x 4 =  560 kWh @ 0.15 =  84.00
  // off-peak  2684 - 560     = 2124 kWh @ 0.08 = 169.92
  // facilities 1 kWh / 0.25 h = 4 kW    @ 20   =  80.00
  // customer charge                            = 100.00
  //                                      total   433.92
  const bill = rate(
    buildProfile({ start: '2026-02-20', end: '2026-03-20', kwh: flat(1) }),
    tariffWithWinterWeekendPeak(),
    period('2026-02-20', '2026-03-20'),
    emptyContext(),
  );

  it('counts 28 calendar days but only 671 hours', () => {
    expect(bill.billingPeriod.days).toBe(28);
    expect(bill.billingPeriod.hours).toBe(671);
  });

  it('charges the per-day and per-month fixed charges off calendar days, not hours/24', () => {
    // The customer charge is per-month, so the lost hour must not prorate it.
    expect(demandLine(bill, 'customer-charge').amount).toBe(100);
  });

  it('sees 2684 intervals and conserves them', () => {
    expect(bill.diagnostics.totalKwh).toBeCloseTo(2684, 9);
    const bucketed = Object.values(bill.diagnostics.kwhBySeasonPeriod).reduce((a, b) => a + b, 0);
    expect(bucketed).toBeCloseTo(2684, 9);
  });

  it('leaves the peak window at 5 clock-hours per day, absorbing the lost hour into off-peak', () => {
    // 28 days x 5 h x 4 quarter-hours, exactly — the transition does not touch it.
    expect(energyKwh(bill, 'winter', 'mid-peak')).toBeCloseTo(560, 9);
    expect(energyKwh(bill, 'winter', 'off-peak')).toBeCloseTo(2124, 9);
    // A DST-naive engine would have found 28 x 96 = 2688 intervals here.
    expect(bill.diagnostics.totalKwh).toBeCloseTo(2684, 9);
  });

  it('totals 433.92', () => {
    expect(bill.total, describeBill(bill)).toBe(433.92);
    expectLinesSumToTotal(bill);
  });
});

describe('A4: a billing period spanning fall-back', () => {
  // Oct 20 - Nov 20 2026, half-open. 12 days in October + 19 in November = 31
  // days, 31 x 24 + 1 = 745 hours, 2980 quarter-hours.
  // The repeated 1 a.m. is inside the off-peak block, so off-peak gains the hour
  // and mid-peak stays at 5 clock-hours x 31 days.
  //
  // mid-peak  31 d x 5 h x 4 =  620 kWh @ 0.15 =  93.00
  // off-peak  2980 - 620     = 2360 kWh @ 0.08 = 188.80
  // facilities 4 kW                     @ 20   =  80.00
  // customer charge                            = 100.00
  //                                      total   461.80
  const bill = rate(
    buildProfile({ start: '2026-10-20', end: '2026-11-20', kwh: flat(1) }),
    tariffWithWinterWeekendPeak(),
    period('2026-10-20', '2026-11-20'),
    emptyContext(),
  );

  it('counts 31 calendar days and 745 hours', () => {
    expect(bill.billingPeriod.days).toBe(31);
    expect(bill.billingPeriod.hours).toBe(745);
  });

  it('conserves the extra hour of usage, billing it off-peak', () => {
    // A DST-naive engine would have found 31 x 96 = 2976 intervals here.
    expect(bill.diagnostics.totalKwh).toBeCloseTo(2980, 9);
    expect(energyKwh(bill, 'winter', 'mid-peak')).toBeCloseTo(620, 9);
    expect(energyKwh(bill, 'winter', 'off-peak')).toBeCloseTo(2360, 9);
  });

  it('totals 461.80', () => {
    expect(bill.total, describeBill(bill)).toBe(461.8);
    expectLinesSumToTotal(bill);
  });
});
