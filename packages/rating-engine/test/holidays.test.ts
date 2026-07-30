/**
 * CATEGORY B — holidays.
 *
 * The engine has no holiday list. The calendar is injected, its dates are already
 * observed-shifted, and an empty calendar must rate every day on its calendar day
 * type. July 4 2026 falls on a Saturday, so a utility observing it would list
 * Friday July 3.
 *
 * Both readings of a holiday clause are exercised: holiday-as-Sunday (which in
 * summer means mid-peak, NOT off-peak) and holiday-as-its-own-day-type mapped to
 * off-peak around the clock.
 */
import { describe, expect, it } from 'vitest';
import { rate } from '@boring/rating-engine';
import type { Tariff } from '@boring/tariff-schema';
import { makeSyntheticTariff, syntheticHolidayCalendar, syntheticTouRules } from '@boring/tariff-schema/testing';
import { buildProfile, emptyContext, flat, period } from './helpers/profile.js';
import { demandLine, describeBill, energyKwh, expectLinesSumToTotal } from './helpers/lines.js';

// July 1-8 2026: Wed 1, Thu 2, Fri 3, Sat 4, Sun 5, Mon 6, Tue 7.
// 5 weekdays, 2 weekend days, 7 x 96 = 672 quarter-hours at 1 kWh each.
const START = '2026-07-01';
const END = '2026-07-08';
const OBSERVED_INDEPENDENCE_DAY = '2026-07-03';

function summerWeek(tariff: Tariff, holidays: string[] = []) {
  return rate(
    buildProfile({ start: START, end: END, kwh: flat(1) }),
    tariff,
    period(START, END),
    emptyContext({ holidayCalendar: syntheticHolidayCalendar(holidays) }),
  );
}

/** Holidays get their own day type, rated off-peak around the clock. */
function holidaysAreOffPeak(): Tariff {
  return makeSyntheticTariff({
    holidayTreatment: { mapsToDayType: 'holiday', citation: 'test' },
    touRules: [
      ...syntheticTouRules(),
      { seasonId: 'summer', dayTypes: ['holiday'], hours: { startHour: 0, endHour: 24 }, periodId: 'off-peak' },
      { seasonId: 'winter', dayTypes: ['holiday'], hours: { startHour: 0, endHour: 24 }, periodId: 'off-peak' },
    ],
  });
}

describe('B7: an empty calendar hardcodes nothing', () => {
  // 5 weekdays x 5 h x 4 = 100 kWh on-peak @ 0.30 = 30.00
  // 2 weekend days x 5 h x 4 = 40 kWh mid-peak @ 0.20 =  8.00
  // remaining 532 kWh off-peak @ 0.10 = 53.20
  // facilities 4 kW @ 20 = 80.00; summer on-peak demand 4 kW @ 12 = 48.00
  // customer charge 100.00                          total   319.20
  const bill = summerWeek(makeSyntheticTariff());

  it('rates July 3 as the ordinary Friday it is', () => {
    expect(energyKwh(bill, 'summer', 'on-peak')).toBeCloseTo(100, 9);
    expect(energyKwh(bill, 'summer', 'mid-peak')).toBeCloseTo(40, 9);
    expect(energyKwh(bill, 'summer', 'off-peak')).toBeCloseTo(532, 9);
    expect(bill.diagnostics.holidaysInPeriod).toEqual([]);
    expect(bill.diagnostics.days.every((d) => !d.isHoliday)).toBe(true);
  });

  it('totals 319.20', () => {
    expect(bill.total, describeBill(bill)).toBe(319.2);
    expectLinesSumToTotal(bill);
  });
});

describe('B6: a holiday rated on the Sunday schedule', () => {
  // July 3 moves from on-peak to mid-peak: 20 kWh shifts from 0.30 to 0.20.
  // on-peak 80 kWh @ 0.30 = 24.00; mid-peak 60 kWh @ 0.20 = 12.00
  // off-peak 532 kWh @ 0.10 = 53.20; demand 80.00 + 48.00; customer 100.00
  //                                                  total   317.20
  const bill = summerWeek(makeSyntheticTariff(), [OBSERVED_INDEPENDENCE_DAY]);

  it('uses the injected date verbatim, shifting nothing itself', () => {
    expect(bill.diagnostics.holidaysInPeriod).toEqual([OBSERVED_INDEPENDENCE_DAY]);
    const july3 = bill.diagnostics.days.find((d) => d.date === OBSERVED_INDEPENDENCE_DAY);
    expect(july3).toMatchObject({ isHoliday: true, dayType: 'sun' });
    // July 4 itself is a Saturday and is NOT in the calendar, so it stays Saturday.
    expect(bill.diagnostics.days.find((d) => d.date === '2026-07-04')).toMatchObject({
      isHoliday: false,
      dayType: 'sat',
    });
  });

  it('moves the holiday out of on-peak and into mid-peak', () => {
    expect(energyKwh(bill, 'summer', 'on-peak')).toBeCloseTo(80, 9);
    expect(energyKwh(bill, 'summer', 'mid-peak')).toBeCloseTo(60, 9);
    expect(energyKwh(bill, 'summer', 'off-peak')).toBeCloseTo(532, 9);
  });

  it('totals 317.20, exactly $2.00 less than the same week with no holiday', () => {
    expect(bill.total, describeBill(bill)).toBe(317.2);
    expect(summerWeek(makeSyntheticTariff()).total - bill.total).toBeCloseTo(2, 9);
    expectLinesSumToTotal(bill);
  });
});

describe('B6b: a holiday rated off-peak around the clock', () => {
  // The other reading of the clause. All 20 of July 3's peak-window kWh become
  // off-peak rather than mid-peak:
  // on-peak 80 @ 0.30 = 24.00; mid-peak 40 @ 0.20 = 8.00; off-peak 552 @ 0.10 = 55.20
  // demand 80.00 + 48.00; customer 100.00              total   315.20
  const bill = summerWeek(holidaysAreOffPeak(), [OBSERVED_INDEPENDENCE_DAY]);

  it('assigns the whole day to off-peak', () => {
    expect(bill.diagnostics.days.find((d) => d.date === OBSERVED_INDEPENDENCE_DAY)).toMatchObject({
      isHoliday: true,
      dayType: 'holiday',
    });
    expect(energyKwh(bill, 'summer', 'on-peak')).toBeCloseTo(80, 9);
    expect(energyKwh(bill, 'summer', 'mid-peak')).toBeCloseTo(40, 9);
    expect(energyKwh(bill, 'summer', 'off-peak')).toBeCloseTo(552, 9);
  });

  it('totals 315.20, cheaper than the holiday-as-Sunday reading', () => {
    expect(bill.total, describeBill(bill)).toBe(315.2);
    expect(bill.total).toBeLessThan(summerWeek(makeSyntheticTariff(), [OBSERVED_INDEPENDENCE_DAY]).total);
    expectLinesSumToTotal(bill);
  });
});

describe('B8: holidays can eliminate a time-related demand charge entirely', () => {
  it('bills 0 kW of on-peak demand when every weekday in the period is a holiday', () => {
    // With all five weekdays observed as holidays there are no summer on-peak
    // hours at all, so the on-peak demand charge has nothing to measure.
    const bill = summerWeek(holidaysAreOffPeak(), [
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-06',
      '2026-07-07',
    ]);

    expect(energyKwh(bill, 'summer', 'on-peak')).toBe(0);
    const onPeakDemand = demandLine(bill, 'trd-summer-on-peak');
    expect(onPeakDemand.quantity).toBe(0);
    expect(onPeakDemand.amount).toBe(0);

    // The facilities charge is unaffected: it does not care what period it is.
    expect(demandLine(bill, 'frd').quantity).toBeCloseTo(4, 9);
    expectLinesSumToTotal(bill);
  });
});
