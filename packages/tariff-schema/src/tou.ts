import { z } from 'zod';
import { CALENDAR_DAY_TYPES, Citation, DayType, Identifier } from './primitives.js';
import type { Season } from './seasons.js';

/** TOU rules are expressed at quarter-hour resolution. */
export const SLOTS_PER_HOUR = 4;
export const SLOTS_PER_DAY = 24 * SLOTS_PER_HOUR;

/**
 * A half-open local-clock window `[startHour, endHour)`.
 *
 * Hours are decimal at quarter-hour resolution: 16.5 is 4:30 pm. `endHour: 24`
 * means midnight at the end of the day. Half-open is what makes adjacent
 * periods (`[0,16)` and `[16,21)`) tile without an off-by-one at the boundary.
 *
 * These are LOCAL CLOCK hours, not elapsed hours. On the spring-forward day the
 * local clock has no 2 a.m., and on the fall-back day it has two 1 a.m.s; a
 * 4 pm - 9 pm window is five clock-hours on both.
 */
export const HourRange = z
  .object({
    startHour: z.number().min(0).max(24),
    endHour: z.number().min(0).max(24),
  })
  .strict()
  .superRefine((h, ctx) => {
    for (const [key, value] of [
      ['startHour', h.startHour],
      ['endHour', h.endHour],
    ] as const) {
      if (Math.round(value * SLOTS_PER_HOUR) !== value * SLOTS_PER_HOUR) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be a multiple of 0.25 (quarter-hour), got ${value}`,
          path: [key],
        });
      }
    }
    if (h.endHour <= h.startHour) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `endHour (${h.endHour}) must be after startHour (${h.startHour}); split a window that wraps midnight into two rules`,
        path: ['endHour'],
      });
    }
  });
export type HourRange = z.infer<typeof HourRange>;

/** A named TOU period. `rank` orders it for display only — it carries no pricing
 * meaning, so reordering periods can never change a bill. */
export const TouPeriodDef = z
  .object({
    id: Identifier,
    label: z.string().min(1),
    rank: z.number().int(),
  })
  .strict();
export type TouPeriodDef = z.infer<typeof TouPeriodDef>;

/**
 * One row of a TOU table: in this season, on these day types, during these
 * hours, the period is `periodId`.
 *
 * Rules must be EXHAUSTIVE and NON-OVERLAPPING across
 * (season x day type x quarter-hour). There is no first-match-wins and no
 * implicit precedence, so "what period is Tuesday 3 pm in July" is answerable
 * from the data alone and cannot change with array order.
 */
export const TouRule = z
  .object({
    seasonId: Identifier,
    dayTypes: z.array(DayType).min(1),
    hours: HourRange,
    periodId: Identifier,
  })
  .strict();
export type TouRule = z.infer<typeof TouRule>;

/**
 * How a holiday is rated.
 *
 * Holiday DATES never live in the tariff — they arrive as an injected calendar,
 * so the engine hardcodes nothing and a historical bill can be rated with the
 * calendar that was in force at the time.
 *
 * `mapsToDayType` covers both readings of a sheet's holiday clause:
 *  - a specific calendar day type (e.g. `sun`) means "rate a holiday on the
 *    Sunday schedule", which in summer may still be mid-peak rather than
 *    off-peak;
 *  - `holiday` means the tariff supplies its own rules with
 *    `dayTypes: ['holiday']`, for sheets that give holidays a distinct row.
 */
export const HolidayTreatment = z
  .object({
    mapsToDayType: DayType,
    citation: Citation,
  })
  .strict();
export type HolidayTreatment = z.infer<typeof HolidayTreatment>;

/** Half-open slot range `[start, end)` for an hour range. */
export function slotRange(hours: HourRange): { start: number; end: number } {
  return {
    start: Math.round(hours.startHour * SLOTS_PER_HOUR),
    end: Math.round(hours.endHour * SLOTS_PER_HOUR),
  };
}

/** The quarter-hour slot a local time falls in. */
export function slotForLocalTime(hour: number, minute: number): number {
  return hour * SLOTS_PER_HOUR + Math.floor(minute / (60 / SLOTS_PER_HOUR));
}

/** Formats a slot index as `HH:MM`, for error messages. */
function formatSlot(slot: number): string {
  const totalMinutes = slot * (60 / SLOTS_PER_HOUR);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Day types the TOU table must cover.
 *
 * When holidays map onto a calendar day type, `holiday` is not a day type the
 * table needs rows for — requiring them would force every tariff to duplicate
 * its Sunday rows.
 */
export function requiredDayTypes(holidayTreatment: HolidayTreatment): DayType[] {
  return holidayTreatment.mapsToDayType === 'holiday'
    ? [...CALENDAR_DAY_TYPES, 'holiday']
    : [...CALENDAR_DAY_TYPES];
}

/**
 * Proves the TOU table is exhaustive and non-overlapping. Returns
 * human-readable problems; empty means sound.
 */
export function checkTouCoverage(
  seasons: readonly Season[],
  rules: readonly TouRule[],
  holidayTreatment: HolidayTreatment,
): string[] {
  const problems: string[] = [];
  const needed = requiredDayTypes(holidayTreatment);

  // A rule targeting `holiday` when holidays are rated as a calendar day type
  // is dead code that reads as if it were live. Reject rather than ignore.
  if (holidayTreatment.mapsToDayType !== 'holiday') {
    for (const [index, rule] of rules.entries()) {
      if (rule.dayTypes.includes('holiday')) {
        problems.push(
          `touRules[${index}] targets day type "holiday", but holidayTreatment.mapsToDayType is "${holidayTreatment.mapsToDayType}", so the rule can never fire`,
        );
      }
    }
  }

  for (const season of seasons) {
    for (const dayType of needed) {
      const owner = new Array<number | undefined>(SLOTS_PER_DAY);
      for (const [index, rule] of rules.entries()) {
        if (rule.seasonId !== season.id) continue;
        if (!rule.dayTypes.includes(dayType)) continue;
        const { start, end } = slotRange(rule.hours);
        for (let slot = start; slot < end; slot += 1) {
          const existing = owner[slot];
          if (existing !== undefined) {
            problems.push(
              `season "${season.id}" ${dayType} ${formatSlot(slot)}: covered by both touRules[${existing}] and touRules[${index}]`,
            );
          } else {
            owner[slot] = index;
          }
        }
      }

      const gaps: number[] = [];
      for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
        if (owner[slot] === undefined) gaps.push(slot);
      }
      if (gaps.length > 0) {
        const ranges = collapseSlotRuns(gaps);
        problems.push(`season "${season.id}" ${dayType}: no TOU rule covers ${ranges}`);
      }
    }
  }

  return problems;
}

/** Renders sorted slot indices as compact `HH:MM-HH:MM` ranges. */
function collapseSlotRuns(slots: readonly number[]): string {
  const runs: string[] = [];
  let runStart = slots[0];
  if (runStart === undefined) return '';
  let previous = runStart;
  for (const slot of slots.slice(1)) {
    if (slot !== previous + 1) {
      runs.push(`${formatSlot(runStart)}-${formatSlot(previous + 1)}`);
      runStart = slot;
    }
    previous = slot;
  }
  runs.push(`${formatSlot(runStart)}-${formatSlot(previous + 1)}`);
  return runs.join(', ');
}
