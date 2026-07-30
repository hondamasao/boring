import { DateTime } from 'luxon';
import type { BillingPeriod, LoadProfile, RatingContextInput, Tariff } from '@boring/tariff-schema';
import { makeSyntheticTariff, syntheticHolidayCalendar } from '@boring/tariff-schema/testing';

export const ZONE = 'America/Los_Angeles';

/**
 * Builds a load profile by walking `[start, end)` in exact interval-length steps.
 *
 * Stepping by DURATION rather than by local clock time is what makes the DST
 * cases real: on the spring-forward day 01:45 PST + 15 min is 03:00 PDT, so no
 * reading ever carries a local 02:xx; on the fall-back day the 01:00 hour is
 * emitted twice, distinguished by its offset. A 24-hour day yields 96 readings at
 * quarter-hour resolution, spring-forward yields 92, fall-back yields 100.
 */
export function buildProfile(options: {
  /** Inclusive local start date. */
  start: string;
  /** Exclusive local end date. */
  end: string;
  intervalMinutes?: number;
  /** kWh for the interval beginning at this local time. */
  kwh: (start: DateTime) => number;
  kvarh?: (start: DateTime) => number;
  meterId?: string;
}): LoadProfile {
  const intervalMinutes = options.intervalMinutes ?? 15;
  const readings: LoadProfile['readings'] = [];

  let cursor = DateTime.fromISO(options.start, { zone: ZONE }).startOf('day');
  const end = DateTime.fromISO(options.end, { zone: ZONE }).startOf('day');
  if (!cursor.isValid || !end.isValid) throw new Error('invalid profile bounds');

  while (cursor < end) {
    const reading: LoadProfile['readings'][number] = {
      start: cursor.toISO({ suppressMilliseconds: true }) as string,
      kwh: options.kwh(cursor),
    };
    if (options.kvarh) reading.kvarh = options.kvarh(cursor);
    readings.push(reading);
    cursor = cursor.plus({ minutes: intervalMinutes });
  }

  const profile: LoadProfile = { timezone: ZONE, intervalMinutes, readings };
  if (options.meterId !== undefined) profile.meterId = options.meterId;
  return profile;
}

/** A flat load: the same kWh in every interval. */
export function flat(kwhPerInterval: number): (start: DateTime) => number {
  return () => kwhPerInterval;
}

/**
 * A flat load with named spikes, keyed by the local ISO instant of the interval
 * that spikes. Used to put a facilities peak somewhere a time-related charge
 * cannot see it.
 */
export function flatWithSpikes(
  kwhPerInterval: number,
  spikes: Record<string, number>,
): (start: DateTime) => number {
  return (start) => {
    const key = start.toISO({ suppressMilliseconds: true }) as string;
    return spikes[key] ?? kwhPerInterval;
  };
}

export function period(start: string, end: string, meterCount = 1): BillingPeriod {
  return { start, end, timezone: ZONE, meterCount };
}

/** A context with no holidays and no history — every default made explicit. */
export function emptyContext(overrides: Partial<RatingContextInput> = {}): RatingContextInput {
  return {
    holidayCalendar: syntheticHolidayCalendar([]),
    demandHistory: { entries: [] },
    serviceAttributes: {},
    ...overrides,
  };
}

/**
 * The baseline synthetic tariff with winter weekends shaped like winter weekdays,
 * so a 4 pm - 9 pm mid-peak window exists on a Sunday.
 *
 * Both 2026 DST transitions fall on a Sunday, and the baseline tariff rates
 * winter weekends as off-peak around the clock — which would make the DST tests
 * unable to observe whether the peak window survived the transition. This variant
 * gives them something to observe.
 */
export function tariffWithWinterWeekendPeak(): Tariff {
  const base = makeSyntheticTariff();
  const withoutWinterWeekendAllDay = base.touRules.filter(
    (rule) =>
      !(
        rule.seasonId === 'winter' &&
        rule.dayTypes.includes('sat') &&
        rule.hours.startHour === 0 &&
        rule.hours.endHour === 24
      ),
  );
  return makeSyntheticTariff({
    touRules: [
      ...withoutWinterWeekendAllDay,
      { seasonId: 'winter', dayTypes: ['sat', 'sun'], hours: { startHour: 0, endHour: 16 }, periodId: 'off-peak' },
      { seasonId: 'winter', dayTypes: ['sat', 'sun'], hours: { startHour: 16, endHour: 21 }, periodId: 'mid-peak' },
      { seasonId: 'winter', dayTypes: ['sat', 'sun'], hours: { startHour: 21, endHour: 24 }, periodId: 'off-peak' },
    ],
  });
}

/** Total of the lines matching a predicate, for readable assertions. */
export function amountWhere(
  lines: readonly { amount: number }[],
  predicate: (line: never) => boolean,
): number {
  return lines.filter(predicate as (line: unknown) => boolean).reduce((sum, l) => sum + l.amount, 0);
}
