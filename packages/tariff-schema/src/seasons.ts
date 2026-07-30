import { z } from 'zod';
import {
  Citation,
  Identifier,
  MONTH_DAY_SLOTS,
  MonthDay,
  monthDayOrdinal,
  ordinalToMonthDay,
} from './primitives.js';

/**
 * A season, bounded by month-days with no year.
 *
 * `start` and `end` are both INCLUSIVE. When `end` sorts before `start` the
 * season wraps the year boundary, which is the normal case for SCE's winter
 * (October 1 - May 31). Encoding the wrap in the comparison rather than in a
 * flag means a wrapping season cannot be written down inconsistently.
 */
export const Season = z
  .object({
    id: Identifier,
    label: z.string().min(1),
    /** Inclusive first day of the season. */
    start: MonthDay,
    /** Inclusive last day. Sorting before `start` means the season wraps December 31. */
    end: MonthDay,
    citation: Citation,
  })
  .strict();
export type Season = z.infer<typeof Season>;

/** The month-day ordinals a season covers, accounting for year wrap. */
export function seasonOrdinals(season: Season): number[] {
  const start = monthDayOrdinal(season.start);
  const end = monthDayOrdinal(season.end);
  const ordinals: number[] = [];
  if (start <= end) {
    for (let o = start; o <= end; o += 1) ordinals.push(o);
  } else {
    for (let o = start; o < MONTH_DAY_SLOTS; o += 1) ordinals.push(o);
    for (let o = 0; o <= end; o += 1) ordinals.push(o);
  }
  return ordinals;
}

/**
 * Proves the seasons tile the year exactly once. Returns human-readable
 * problems; an empty array means the set is sound.
 *
 * This is a hard requirement rather than a warning: if a day belongs to no
 * season the engine has no rate for it, and if a day belongs to two the answer
 * depends on array order. Both failures are silent and expensive, so they are
 * rejected at parse time.
 */
export function checkSeasonTiling(seasons: readonly Season[]): string[] {
  const problems: string[] = [];
  const owner = new Array<string | undefined>(MONTH_DAY_SLOTS);

  for (const season of seasons) {
    for (const ordinal of seasonOrdinals(season)) {
      const existing = owner[ordinal];
      if (existing !== undefined) {
        const md = ordinalToMonthDay(ordinal);
        problems.push(
          `${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')} is covered by both season "${existing}" and season "${season.id}"`,
        );
      } else {
        owner[ordinal] = season.id;
      }
    }
  }

  const uncovered: string[] = [];
  for (let ordinal = 0; ordinal < MONTH_DAY_SLOTS; ordinal += 1) {
    if (owner[ordinal] === undefined) {
      const md = ordinalToMonthDay(ordinal);
      uncovered.push(`${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`);
    }
  }
  if (uncovered.length > 0) {
    // Collapse to a count plus a sample; a tariff missing half the year should
    // not produce 180 identical-looking issues.
    const sample = uncovered.slice(0, 5).join(', ');
    const suffix = uncovered.length > 5 ? `, ... (${uncovered.length} total)` : '';
    problems.push(`no season covers: ${sample}${suffix}`);
  }

  return problems;
}

/**
 * The season containing a month-day, or null if the seasons do not tile the
 * year. Callers that parsed through `Tariff` can treat null as unreachable.
 */
export function seasonIdForMonthDay(seasons: readonly Season[], md: MonthDay): string | null {
  const target = monthDayOrdinal(md);
  for (const season of seasons) {
    if (seasonOrdinals(season).includes(target)) return season.id;
  }
  return null;
}
