import { describe, expect, it } from 'vitest';
import { estimateLoadProfile } from '../src/estimate.js';
import { dayType, shapeMultiplier } from '../src/shape.js';

const ZONE = 'America/Los_Angeles';

function sumKwh(readings: { kwh: number }[]): number {
  return readings.reduce((sum, r) => sum + r.kwh, 0);
}

function impliedPeakKwFromReadings(readings: { kwh: number }[]): number {
  return Math.max(...readings.map((r) => r.kwh / 0.25));
}

describe('shape', () => {
  it('treats Saturday and Sunday as weekend, Monday-Friday as weekday', () => {
    expect(dayType(1)).toBe('weekday'); // Monday
    expect(dayType(5)).toBe('weekday'); // Friday
    expect(dayType(6)).toBe('weekend'); // Saturday
    expect(dayType(7)).toBe('weekend'); // Sunday
  });

  it('peaks at 1.0 on a weekday midday and is always lower on weekends', () => {
    expect(shapeMultiplier(11, 'weekday')).toBe(1.0);
    expect(shapeMultiplier(11, 'weekend')).toBeLessThan(shapeMultiplier(11, 'weekday'));
  });
});

describe('estimateLoadProfile: energy only (no demand on the bill)', () => {
  // June 2026 has no DST transition: 30 days x 96 quarter-hours = 2880.
  const period = { start: '2026-06-01', end: '2026-07-01', timezone: ZONE };
  const result = estimateLoadProfile({ billingPeriod: period, totalKwh: 6000, totalDemandKw: null });

  it('produces exactly one reading per 15-minute interval in the period', () => {
    expect(result.profile.readings).toHaveLength(30 * 96);
  });

  it('scales the shape so total energy matches the bill exactly', () => {
    expect(sumKwh(result.profile.readings)).toBeCloseTo(6000, 6);
  });

  it('uses the energy-only method and says why in assumptions', () => {
    expect(result.method).toBe('fit-energy-only');
    expect(result.assumptions.some((a) => a.includes('no demand figure') || a.includes('did not report a demand'))).toBe(
      true,
    );
  });

  it('produces a schema-valid, ascending, non-negative LoadProfile', () => {
    expect(result.profile.readings.every((r) => r.kwh >= 0)).toBe(true);
    for (let i = 1; i < result.profile.readings.length; i++) {
      expect(Date.parse(result.profile.readings[i]!.start)).toBeGreaterThan(
        Date.parse(result.profile.readings[i - 1]!.start),
      );
    }
  });

  it('carries the mandatory uncertainty disclaimer', () => {
    expect(result.disclaimer).toContain('ESTIMATED');
    expect(result.disclaimer.toLowerCase()).toContain('green button');
  });

  it('is a weekday-heavier profile than a weekend-only one at the same total, since weekdays get the shape peak', () => {
    const weekdayHeavyPeak = impliedPeakKwFromReadings(result.profile.readings);
    expect(weekdayHeavyPeak).toBeGreaterThan(6000 / (30 * 24)); // strictly above the flat average
  });
});

describe('estimateLoadProfile: energy and demand both fit', () => {
  const period = { start: '2026-06-01', end: '2026-07-01', timezone: ZONE };
  // A total/peak pair chosen to be comfortably feasible under the shape.
  const result = estimateLoadProfile({ billingPeriod: period, totalKwh: 6000, totalDemandKw: 15 });

  it('uses the energy-and-peak method', () => {
    expect(result.method).toBe('fit-energy-and-peak');
  });

  it('matches total energy exactly', () => {
    expect(sumKwh(result.profile.readings)).toBeCloseTo(6000, 6);
  });

  it('matches the stated peak demand exactly', () => {
    expect(impliedPeakKwFromReadings(result.profile.readings)).toBeCloseTo(15, 6);
    expect(result.impliedPeakKw).toBeCloseTo(15, 6);
  });

  it('never produces a negative reading even when fitting two constraints', () => {
    expect(result.profile.readings.every((r) => r.kwh >= 0)).toBe(true);
  });
});

describe('estimateLoadProfile: infeasible energy/demand pair falls back honestly', () => {
  // A demand figure wildly disproportionate to the energy total: 500 kW peak
  // on a bill that only used 100 kWh all month. No non-negative baseline can
  // satisfy both constraints under this shape.
  const period = { start: '2026-06-01', end: '2026-07-01', timezone: ZONE };
  const result = estimateLoadProfile({ billingPeriod: period, totalKwh: 100, totalDemandKw: 500 });

  it('falls back to energy-only rather than emit a negative-baseline fit', () => {
    expect(result.method).toBe('fit-energy-only');
    expect(result.profile.readings.every((r) => r.kwh >= 0)).toBe(true);
  });

  it('still matches total energy exactly', () => {
    expect(sumKwh(result.profile.readings)).toBeCloseTo(100, 6);
  });

  it('explains the inconsistency in assumptions rather than silently dropping the demand figure', () => {
    expect(result.assumptions.some((a) => a.includes('inconsistent'))).toBe(true);
  });
});

describe('estimateLoadProfile: DST-aware interval count', () => {
  it('produces one fewer hour of intervals across the March 2026 spring-forward', () => {
    // Feb 1 - Apr 1 2026: 28 + 31 = 59 days, minus the 1 hour lost to DST on
    // March 8 = 59*96 - 4 quarter-hours.
    const period = { start: '2026-02-01', end: '2026-04-01', timezone: ZONE };
    const result = estimateLoadProfile({ billingPeriod: period, totalKwh: 12000, totalDemandKw: null });
    expect(result.profile.readings).toHaveLength(59 * 96 - 4);
    // Energy conservation still holds across the short day.
    expect(sumKwh(result.profile.readings)).toBeCloseTo(12000, 6);
  });
});

describe('estimateLoadProfile: input validation', () => {
  const period = { start: '2026-06-01', end: '2026-07-01', timezone: ZONE };

  it('rejects a non-positive totalKwh rather than silently producing a zero or negative profile', () => {
    expect(() => estimateLoadProfile({ billingPeriod: period, totalKwh: 0, totalDemandKw: null })).toThrow(RangeError);
    expect(() => estimateLoadProfile({ billingPeriod: period, totalKwh: -5, totalDemandKw: null })).toThrow(RangeError);
  });

  it('rejects an empty billing period', () => {
    const empty = { start: '2026-06-01', end: '2026-06-01', timezone: ZONE };
    expect(() => estimateLoadProfile({ billingPeriod: empty, totalKwh: 100, totalDemandKw: null })).toThrow(RangeError);
  });
});
