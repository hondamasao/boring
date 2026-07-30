/**
 * Money arithmetic.
 *
 * Every line is rounded to the cent, and the total is the sum of the rounded
 * lines — matching how a bill presents itself, so "each line item within $1" is
 * a comparison against numbers a human can actually see.
 *
 * Summing happens in integer cents so the total equals the sum of the lines
 * exactly rather than to within a floating-point crumb.
 */

/** Guards against binary representation error: 1.005 is stored slightly below
 * 1.005, and naive rounding would take it down to 1.00. */
const EPSILON = 1e-9;

/** Half-up rounding to cents, symmetric about zero so credits round like charges. */
export function roundToCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError(`cannot round ${amount}`);
  const sign = amount < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(amount) * 100 + 0.5 + EPSILON)) / 100;
}

/** An amount as an integer number of cents. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError(`cannot convert ${amount} to cents`);
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(amount) * 100 + 0.5 + EPSILON);
}

/** Integer cents back to dollars. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Sums already-rounded amounts without accumulating float error. */
export function sumAmounts(amounts: readonly number[]): number {
  let cents = 0;
  for (const amount of amounts) cents += toCents(amount);
  return fromCents(cents);
}
