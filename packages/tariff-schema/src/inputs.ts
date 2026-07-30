import { z } from 'zod';
import {
  CustomerClass,
  Identifier,
  IanaTimeZone,
  IsoDate,
  IsoInstant,
  IsoMonth,
  NonNegativeRate,
  Rate,
  VoltageLevel,
  dividesAnHour,
} from './primitives.js';

/**
 * One metered interval.
 *
 * `start` must carry an explicit offset or `Z`. A naive local timestamp is
 * rejected: during the fall-back hour `2026-11-01T01:30:00` names two distinct
 * instants, and quietly picking one would break exactly the 25-hour day the
 * engine exists to get right. Green Button exports that omit offsets must be
 * resolved by the parser that reads them, not here.
 *
 * `kvarh` and `kva` are optional and present from the start, so adding a
 * power-factor clause later is a data change rather than a signature change.
 */
export const IntervalReading = z
  .object({
    start: IsoInstant,
    kwh: Rate,
    kvarh: Rate.optional(),
    kva: NonNegativeRate.optional(),
  })
  .strict();
export type IntervalReading = z.infer<typeof IntervalReading>;

/**
 * A meter's interval data.
 *
 * `intervalMinutes` is uniform across the profile. Real Green Button exports are
 * uniform, and the assumption makes demand-window aggregation exact instead of
 * a weighted guess. A profile with mixed interval lengths must be split.
 */
export const LoadProfile = z
  .object({
    meterId: z.string().min(1).optional(),
    timezone: IanaTimeZone,
    intervalMinutes: z.number().int().positive(),
    readings: z.array(IntervalReading),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (!dividesAnHour(profile.intervalMinutes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `intervalMinutes must divide 60, got ${profile.intervalMinutes}`,
        path: ['intervalMinutes'],
      });
    }

    let previous = Number.NEGATIVE_INFINITY;
    for (const [index, reading] of profile.readings.entries()) {
      const instant = Date.parse(reading.start);
      if (Number.isNaN(instant)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unparseable instant "${reading.start}"`,
          path: ['readings', index, 'start'],
        });
        return;
      }
      if (instant === previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate interval start "${reading.start}"`,
          path: ['readings', index, 'start'],
        });
      } else if (instant < previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `readings must be sorted ascending by instant; "${reading.start}" precedes the reading before it`,
          path: ['readings', index, 'start'],
        });
      }
      previous = instant;
    }
  });
export type LoadProfile = z.infer<typeof LoadProfile>;

/**
 * A billing period as `[start, end)` in local calendar dates.
 *
 * End-exclusive so that consecutive periods share a boundary date without
 * double-counting a day, which is how meter-read to meter-read cycles work.
 * `days` is therefore the count of local calendar days in the range — 31 days
 * for Oct 20 - Nov 20 even though that span contains 745 hours.
 */
export const BillingPeriod = z
  .object({
    start: IsoDate,
    end: IsoDate,
    timezone: IanaTimeZone,
    meterCount: z.number().int().positive(),
  })
  .strict()
  .superRefine((period, ctx) => {
    if (period.end <= period.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `end (${period.end}) must be after start (${period.start}); the range is half-open [start, end)`,
        path: ['end'],
      });
    }
  });
export type BillingPeriod = z.infer<typeof BillingPeriod>;

/**
 * A prior month's demand, as billed. Supplied by the caller — the money path
 * does no I/O, so history is an argument rather than a lookup.
 *
 * `facilitiesPeakKw` is the month's maximum demand at any time, which is what
 * both facilities ratchets and eligibility rules key off.
 * `timeRelatedPeaksKw` is keyed by time-related charge id.
 */
export const DemandHistoryEntry = z
  .object({
    month: IsoMonth,
    /** The season that month fell in, for `same-season-only` ratchets. Null when
     * unknown, which excludes the entry from season-scoped ratchets. */
    seasonId: Identifier.nullable(),
    facilitiesPeakKw: NonNegativeRate,
    timeRelatedPeaksKw: z.record(Identifier, NonNegativeRate),
  })
  .strict();
export type DemandHistoryEntry = z.infer<typeof DemandHistoryEntry>;

export const DemandHistory = z
  .object({
    entries: z.array(DemandHistoryEntry),
  })
  .strict()
  .superRefine((history, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of history.entries.entries()) {
      if (seen.has(entry.month)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate history entry for month ${entry.month}`,
          path: ['entries', index, 'month'],
        });
      }
      seen.add(entry.month);
    }
  });
export type DemandHistory = z.infer<typeof DemandHistory>;

/**
 * Injected holiday calendar. Dates are ALREADY OBSERVED-SHIFTED by whoever built
 * the calendar; the engine does no rolling of its own, so a holiday that the
 * utility observed on a Monday is listed as that Monday.
 *
 * The engine has no built-in holiday list. Passing an empty calendar rates every
 * day on its calendar day type — which is the assertion that nothing is
 * hardcoded.
 */
export const HolidayCalendar = z
  .object({
    utility: z.string().min(1),
    source: z.string().min(1),
    /** Local dates the utility observes as holidays. */
    observedDates: z.array(IsoDate),
  })
  .strict();
export type HolidayCalendar = z.infer<typeof HolidayCalendar>;

/**
 * Facts about the service point rather than the schedule.
 *
 * `demandWindowMinutesOverride` exists because the 5-minute demand interval is a
 * utility determination for loads that are intermittent or subject to violent
 * fluctuation — an account fact, not a property of the sheet. Encoding it on the
 * tariff would require a duplicate tariff record per customer.
 */
export const ServiceAttributes = z
  .object({
    voltageLevel: VoltageLevel.optional(),
    customerClass: CustomerClass.optional(),
    /** For forward-looking eligibility rules. */
    expectedMaxDemandKw: NonNegativeRate.optional(),
    demandWindowMinutesOverride: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((attrs, ctx) => {
    if (
      attrs.demandWindowMinutesOverride !== undefined &&
      !dividesAnHour(attrs.demandWindowMinutesOverride)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `demandWindowMinutesOverride must divide 60, got ${attrs.demandWindowMinutesOverride}`,
        path: ['demandWindowMinutesOverride'],
      });
    }
  });
export type ServiceAttributes = z.infer<typeof ServiceAttributes>;

/**
 * Everything the engine needs that is neither the tariff nor the meter data.
 * No hidden globals and no defaults that could pass for a hardcoded holiday list.
 */
export const RatingContext = z
  .object({
    holidayCalendar: HolidayCalendar,
    demandHistory: DemandHistory.default({ entries: [] }),
    serviceAttributes: ServiceAttributes.default({}),
  })
  .strict();
export type RatingContext = z.infer<typeof RatingContext>;
export type RatingContextInput = z.input<typeof RatingContext>;

/** Sentinel for "no holidays", so a caller opting out has to say so explicitly. */
export const NO_HOLIDAYS: HolidayCalendar = {
  utility: 'none',
  source: 'explicitly empty calendar',
  observedDates: [],
};

/** An `IsoInstant` as epoch milliseconds. Pure — parses the string, never reads a clock. */
export function instantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`unparseable instant: ${iso}`);
  return ms;
}
