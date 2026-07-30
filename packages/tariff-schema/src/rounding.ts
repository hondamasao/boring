import { z } from 'zod';

/**
 * How money is rounded.
 *
 * The default matches how an SCE bill presents itself: every line is rounded to
 * the cent and the total is the sum of the rounded lines. That ordering is what
 * makes "each line item within $1" a meaningful assertion — if the engine summed
 * unrounded values and rounded once at the end, its lines would not be the
 * numbers a human sees on the paper bill.
 *
 * The engine sums in integer cents, so the total equals the sum of the lines
 * exactly rather than approximately.
 */
export const RoundingPolicy = z
  .object({
    lineItemDecimals: z.literal(2),
    mode: z.literal('half-up'),
  })
  .strict();
export type RoundingPolicy = z.infer<typeof RoundingPolicy>;

export const DEFAULT_ROUNDING: RoundingPolicy = {
  lineItemDecimals: 2,
  mode: 'half-up',
};
