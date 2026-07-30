import { z } from 'zod';

/**
 * Shared leaf schemas. Everything here is intentionally boring: the interesting
 * decisions live in the composite schemas that consume these.
 */

/** IANA time zone name. Not validated against the tz database here — the engine
 * asserts the tariff, billing period and load profile all agree, and luxon
 * rejects unknown zones at rating time. */
export const IanaTimeZone = z.string().min(1);

/**
 * Cost component. REQUIRED on every charge-bearing node and every bill line.
 *
 * Two reasons this is not optional:
 *  - line-by-line reconciliation against a real SCE bill is impossible without
 *    it, because the bill itself is split this way;
 *  - for a CCA / Direct Access customer the generation component is billed by
 *    the CCA, not SCE, so a report has to state which component a
 *    recommendation actually moves.
 *
 * `cost-responsibility-surcharge` covers PCIA / CRS. These appear on CCA bills
 * and are NOT delivery, so they get their own component rather than being
 * folded into delivery or public-purpose.
 */
export const Component = z.enum([
  'generation',
  'delivery',
  'transmission',
  'public-purpose',
  'cost-responsibility-surcharge',
  'taxes-and-fees',
  'bundled',
]);
export type Component = z.infer<typeof Component>;

/**
 * Day type. `holiday` is a first-class day type rather than a boolean flag,
 * so a tariff whose holidays get their own TOU rows can express that directly.
 * See `HolidayTreatment` for how a holiday maps onto these.
 */
export const DayType = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday']);
export type DayType = z.infer<typeof DayType>;

/** Calendar day types, in luxon weekday order (Monday = 1). Excludes `holiday`. */
export const CALENDAR_DAY_TYPES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Charge types that can appear on a bill line. Referenced by percent-of-subtotal
 * rider bases, so it lives in the schema package rather than the engine. */
export const ChargeType = z.enum([
  'energy',
  'facilities-demand',
  'time-related-demand',
  'customer-charge',
  'meter-charge',
  'daily-minimum-charge',
  'rider',
  'power-factor-adjustment',
  'minimum-bill-adjustment',
]);
export type ChargeType = z.infer<typeof ChargeType>;

/** Voltage levels as SCE delineates them. */
export const VoltageLevel = z.enum(['secondary', 'primary', 'subtransmission', 'transmission']);
export type VoltageLevel = z.infer<typeof VoltageLevel>;

/** Customer classes in scope. `residential` is deliberately absent: residential
 * (TOU-D) is permanently out of scope, so it is not representable. */
export const CustomerClass = z.enum(['general-service', 'agricultural', 'lighting', 'standby']);
export type CustomerClass = z.infer<typeof CustomerClass>;

/** A rate or amount. May be negative — credits are real line items. */
export const Rate = z.number().finite();

/** A quantity or amount that cannot sensibly go negative. */
export const NonNegativeRate = z.number().finite().nonnegative();

/** A proportion expressed as a fraction, not as "10" meaning 10%. */
export const Proportion = z.number().finite().min(-1).max(1);

/** `YYYY-MM-DD`, interpreted in the tariff's local time zone. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'must be YYYY-MM-DD');

/** `YYYY-MM`. */
export const IsoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');

/**
 * Instant with an EXPLICIT offset or `Z`. A naive timestamp is rejected on
 * purpose: during the America/Los_Angeles fall-back hour, `2026-11-01T01:30:00`
 * names two different instants, and silently picking one would corrupt exactly
 * the 25-hour-day case the engine is meant to get right.
 */
export const IsoInstant = z.string().datetime({ offset: true });

/** Lowercase kebab identifier, so ids are stable and safe in JSON pointers. */
export const Identifier = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'must be lowercase kebab-case');

/** A human-readable pointer to the tariff text a value came from. Every priced
 * node carries one, so no dollar figure is unattributable (CLAUDE.md #5). */
export const Citation = z.string().min(1);

/** Days per month using a leap-year layout, so Feb 29 is a valid month-day. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * A month-day boundary, with no year. Season boundaries are year-independent;
 * pinning them to a year would force a new tariff record every January.
 */
export const MonthDay = z
  .object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict()
  .superRefine((md, ctx) => {
    const max = DAYS_IN_MONTH[md.month - 1] ?? 31;
    if (md.day > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `month ${md.month} has at most ${max} days, got ${md.day}`,
        path: ['day'],
      });
    }
  });
export type MonthDay = z.infer<typeof MonthDay>;

/** Number of month-day slots in the leap-year layout used for season tiling. */
export const MONTH_DAY_SLOTS = 366;

const MONTH_START_ORDINAL: readonly number[] = (() => {
  const starts: number[] = [];
  let running = 0;
  for (const days of DAYS_IN_MONTH) {
    starts.push(running);
    running += days;
  }
  return starts;
})();

/**
 * Maps a month-day onto `[0, 366)` using a leap-year layout. Used to prove that
 * a tariff's seasons tile the year exactly once, including wrapping seasons like
 * October 1 - May 31.
 */
export function monthDayOrdinal(md: MonthDay): number {
  const monthStart = MONTH_START_ORDINAL[md.month - 1];
  if (monthStart === undefined) throw new RangeError(`invalid month ${md.month}`);
  return monthStart + (md.day - 1);
}

/** Inverse of {@link monthDayOrdinal}. */
export function ordinalToMonthDay(ordinal: number): MonthDay {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= MONTH_DAY_SLOTS) {
    throw new RangeError(`ordinal out of range: ${ordinal}`);
  }
  for (let month = 12; month >= 1; month -= 1) {
    const start = MONTH_START_ORDINAL[month - 1] as number;
    if (ordinal >= start) return { month, day: ordinal - start + 1 };
  }
  throw new RangeError(`unreachable ordinal ${ordinal}`);
}

/** True when `minutes` divides an hour evenly. */
export function dividesAnHour(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 60 && 60 % minutes === 0;
}
