import { RatingError } from './errors.js';

/** `YYYY-MM` arithmetic, kept away from Date so nothing can consult a clock. */

export function parseMonth(month: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (match === null) throw new RatingError(`not a YYYY-MM month: "${month}"`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(month: string, delta: number): string {
  const { year, month: m } = parseMonth(month);
  const zeroBased = year * 12 + (m - 1) + delta;
  return formatMonth(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

/**
 * The `count` months immediately BEFORE `month`, most recent first.
 *
 * The month being billed is excluded: a ratchet is a floor set by a PRIOR month,
 * and letting this month's own peak floor itself would be a no-op dressed up as a
 * rule.
 */
export function precedingMonths(month: string, count: number): string[] {
  const months: string[] = [];
  for (let i = 1; i <= count; i += 1) months.push(addMonths(month, -i));
  return months;
}

/** A window of `count` months ending at `month`, inclusive or not. */
export function monthWindow(month: string, count: number, includeCurrent: boolean): string[] {
  return includeCurrent
    ? [month, ...precedingMonths(month, count - 1)]
    : precedingMonths(month, count);
}
