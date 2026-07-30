import { describe, expect, it } from 'vitest';
import {
  HourRange,
  SLOTS_PER_DAY,
  checkTouCoverage,
  requiredDayTypes,
  slotForLocalTime,
  slotRange,
  type HolidayTreatment,
  type TouRule,
} from '@boring/tariff-schema';
import { syntheticSeasons, syntheticTouRules } from '@boring/tariff-schema/testing';

const asSunday: HolidayTreatment = { mapsToDayType: 'sun', citation: 'test' };
const asOwnDayType: HolidayTreatment = { mapsToDayType: 'holiday', citation: 'test' };

describe('HourRange', () => {
  it('accepts quarter-hour boundaries and a 24 end', () => {
    expect(HourRange.parse({ startHour: 16.25, endHour: 21 })).toEqual({
      startHour: 16.25,
      endHour: 21,
    });
    expect(HourRange.parse({ startHour: 21, endHour: 24 }).endHour).toBe(24);
  });

  it('rejects sub-quarter-hour precision', () => {
    const result = HourRange.safeParse({ startHour: 16.1, endHour: 21 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('multiple of 0.25');
    }
  });

  it('rejects a window that wraps midnight, directing the author to split it', () => {
    const result = HourRange.safeParse({ startHour: 22, endHour: 6 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('split a window that wraps midnight');
    }
  });

  it('rejects a zero-width window', () => {
    expect(HourRange.safeParse({ startHour: 16, endHour: 16 }).success).toBe(false);
  });
});

describe('slot arithmetic', () => {
  it('maps the 4 pm - 9 pm window to 20 quarter-hour slots', () => {
    const { start, end } = slotRange({ startHour: 16, endHour: 21 });
    expect(start).toBe(64);
    expect(end).toBe(84);
    expect(end - start).toBe(20);
  });

  it('places local times in half-open slots', () => {
    expect(slotForLocalTime(0, 0)).toBe(0);
    expect(slotForLocalTime(16, 0)).toBe(64);
    expect(slotForLocalTime(16, 14)).toBe(64);
    expect(slotForLocalTime(16, 15)).toBe(65);
    expect(slotForLocalTime(23, 59)).toBe(SLOTS_PER_DAY - 1);
  });
});

describe('requiredDayTypes', () => {
  it('omits `holiday` when holidays map onto a calendar day type', () => {
    expect(requiredDayTypes(asSunday)).not.toContain('holiday');
    expect(requiredDayTypes(asSunday)).toHaveLength(7);
  });

  it('requires `holiday` rows when the tariff gives holidays their own day type', () => {
    expect(requiredDayTypes(asOwnDayType)).toContain('holiday');
    expect(requiredDayTypes(asOwnDayType)).toHaveLength(8);
  });
});

describe('checkTouCoverage', () => {
  const seasons = syntheticSeasons();

  it('accepts an exhaustive, non-overlapping table', () => {
    expect(checkTouCoverage(seasons, syntheticTouRules(), asSunday)).toEqual([]);
  });

  it('reports a gap with the exact missing clock range', () => {
    // Drop the summer weekday 21:00-24:00 off-peak row.
    const rules = syntheticTouRules().filter(
      (r) => !(r.seasonId === 'summer' && r.hours.startHour === 21 && r.dayTypes.includes('mon')),
    );
    const problems = checkTouCoverage(seasons, rules, asSunday);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('summer') && p.includes('mon') && p.includes('21:00-24:00'))).toBe(true);
    // Weekends still tile, so they must not be reported.
    expect(problems.some((p) => p.includes('sat'))).toBe(false);
  });

  it('reports an overlap naming both rules', () => {
    const rules: TouRule[] = [
      ...syntheticTouRules(),
      {
        seasonId: 'summer',
        dayTypes: ['mon'],
        hours: { startHour: 17, endHour: 18 },
        periodId: 'mid-peak',
      },
    ];
    const problems = checkTouCoverage(seasons, rules, asSunday);
    expect(problems.some((p) => p.includes('covered by both touRules['))).toBe(true);
  });

  it('rejects a holiday rule that can never fire', () => {
    const rules: TouRule[] = [
      ...syntheticTouRules(),
      {
        seasonId: 'summer',
        dayTypes: ['holiday'],
        hours: { startHour: 0, endHour: 24 },
        periodId: 'off-peak',
      },
    ];
    const problems = checkTouCoverage(seasons, rules, asSunday);
    expect(problems.some((p) => p.includes('can never fire'))).toBe(true);
  });

  it('requires holiday rows when holidays are their own day type', () => {
    const problems = checkTouCoverage(seasons, syntheticTouRules(), asOwnDayType);
    expect(problems.some((p) => p.includes('holiday') && p.includes('00:00-24:00'))).toBe(true);
  });

  it('accepts holidays as their own day type once rows exist', () => {
    const rules: TouRule[] = [
      ...syntheticTouRules(),
      { seasonId: 'summer', dayTypes: ['holiday'], hours: { startHour: 0, endHour: 24 }, periodId: 'off-peak' },
      { seasonId: 'winter', dayTypes: ['holiday'], hours: { startHour: 0, endHour: 24 }, periodId: 'off-peak' },
    ];
    expect(checkTouCoverage(seasons, rules, asOwnDayType)).toEqual([]);
  });
});
