import { z } from 'zod';
import { Citation, Component, Identifier, NonNegativeRate } from './primitives.js';
import { STAGE } from './stages.js';

/**
 * Which lines the minimum is compared against.
 *
 * A sheet's minimum may be a floor on the whole bill or only on some part of it,
 * and taxes may or may not be inside the comparison. Both readings are
 * expressible; neither is a default.
 */
export const MinimumBillScope = z
  .object({
    includeStages: z.array(z.number().int().min(0)).min(1),
    components: z.array(Component).min(1).nullable(),
    excludeComponents: z.array(Component).min(1).nullable(),
  })
  .strict()
  .superRefine((scope, ctx) => {
    for (const [index, stage] of scope.includeStages.entries()) {
      if (stage >= STAGE.MINIMUM_BILL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `the minimum-bill test runs at stage ${STAGE.MINIMUM_BILL}, so it cannot compare against stage ${stage}`,
          path: ['includeStages', index],
        });
      }
    }
  });
export type MinimumBillScope = z.infer<typeof MinimumBillScope>;

/**
 * Minimum bill logic.
 *
 * When the minimum bites, the engine emits a `minimum-bill-adjustment` LINE for
 * the shortfall and leaves every earlier line untouched. It never replaces the
 * computed charges: a bill that silently rewrites its own itemization cannot be
 * reconciled against the real one, and the billing-error detector needs to see
 * what the charges would have been.
 *
 * Three forms, all implemented and tested:
 *  - `per-day`: amount x days in the billing period;
 *  - `per-month`: a flat monthly floor;
 *  - `charge-floor`: the floor IS the sum of named charges, which is how a
 *    demand-metered schedule words "minimum charge: the customer charge plus the
 *    facilities-related demand charge".
 *
 * Which form TOU-GS-2 uses is read off the sheet.
 */
export const MinimumBill = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('per-day'),
      amountPerDay: NonNegativeRate,
      perMeter: z.boolean(),
      component: Component,
      comparisonScope: MinimumBillScope,
      citation: Citation,
    })
    .strict(),

  z
    .object({
      kind: z.literal('per-month'),
      amountPerMonth: NonNegativeRate,
      perMeter: z.boolean(),
      component: Component,
      comparisonScope: MinimumBillScope,
      citation: Citation,
    })
    .strict(),

  z
    .object({
      kind: z.literal('charge-floor'),
      /** Ids of charges whose amounts sum to the floor. Resolved against the
       * tariff's fixed charges and demand charges at parse time. */
      floorChargeIds: z.array(Identifier).min(1),
      component: Component,
      comparisonScope: MinimumBillScope,
      citation: Citation,
    })
    .strict(),
]);
export type MinimumBill = z.infer<typeof MinimumBill>;
