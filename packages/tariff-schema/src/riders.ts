import { z } from 'zod';
import {
  ChargeType,
  Citation,
  Component,
  Identifier,
  Proportion,
  Rate,
} from './primitives.js';
import { PERCENT_RIDER_STAGES } from './stages.js';

/** Which energy a per-kWh rider rides on. Null means "all". */
export const EnergyScope = z
  .object({
    seasonIds: z.array(Identifier).min(1).nullable(),
    periodIds: z.array(Identifier).min(1).nullable(),
  })
  .strict();
export type EnergyScope = z.infer<typeof EnergyScope>;

/** Which demand a per-kW rider rides on. Null means "every demand charge". */
export const DemandScope = z
  .object({
    chargeIds: z.array(Identifier).min(1).nullable(),
  })
  .strict();
export type DemandScope = z.infer<typeof DemandScope>;

/**
 * The base a percent-of-subtotal rider is applied to, stated explicitly.
 *
 * `includeStages` is the whole mechanism: a rider names the stages whose lines
 * it taxes. `STAGE.MINIMUM_BILL` (4) is a stage like any other, so whether the
 * minimum-bill make-up amount is taxed is a written-down choice rather than an
 * accident of evaluation order.
 *
 * The component filters are what let a local utility users' tax exclude the
 * generation component for a CCA customer.
 */
export const PercentRiderBase = z
  .object({
    /** Stages whose lines form the base. Must all be earlier than the rider's own. */
    includeStages: z.array(z.number().int().min(0)).min(1),
    /** Null means every charge type. */
    chargeTypes: z.array(ChargeType).min(1).nullable(),
    /** Null means every component. */
    components: z.array(Component).min(1).nullable(),
    /** Applied after `components`. Null means exclude nothing. */
    excludeComponents: z.array(Component).min(1).nullable(),
  })
  .strict();
export type PercentRiderBase = z.infer<typeof PercentRiderBase>;

const percentStage = z.union([
  z.literal(PERCENT_RIDER_STAGES[0]),
  z.literal(PERCENT_RIDER_STAGES[1]),
]);

/**
 * A rider, discriminated by its billing basis.
 *
 * Order of operations (see `stages.ts`): per-kWh and per-kW riders run at stage
 * 2, flat riders at stage 3, and percent-of-subtotal riders at stage 5 or 6 —
 * after the minimum-bill test. Riders at the same stage never compound with each
 * other; a stage-6 rider does see stage 5's amounts.
 */
export const Rider = z
  .discriminatedUnion('basis', [
    z
      .object({
        basis: z.literal('per-kwh'),
        id: Identifier,
        label: z.string().min(1),
        component: Component,
        ratePerKwh: Rate,
        scope: EnergyScope,
        citation: Citation,
      })
      .strict(),

    z
      .object({
        basis: z.literal('per-kw'),
        id: Identifier,
        label: z.string().min(1),
        component: Component,
        ratePerKw: Rate,
        scope: DemandScope,
        citation: Citation,
      })
      .strict(),

    z
      .object({
        basis: z.literal('flat'),
        id: Identifier,
        label: z.string().min(1),
        component: Component,
        amount: Rate,
        per: z.enum(['month', 'day', 'meter-month', 'meter-day']),
        citation: Citation,
      })
      .strict(),

    z
      .object({
        basis: z.literal('percent-of-subtotal'),
        id: Identifier,
        label: z.string().min(1),
        component: Component,
        /** A fraction, not a display percentage: 10% is 0.10. */
        percent: Proportion,
        stage: percentStage,
        base: PercentRiderBase,
        citation: Citation,
      })
      .strict(),
  ])
  // Refined on the union rather than the member: zod's discriminated union needs
  // plain object members to read the discriminator off.
  .superRefine((rider, ctx) => {
    if (rider.basis !== 'percent-of-subtotal') return;
    for (const [index, stage] of rider.base.includeStages.entries()) {
      if (stage >= rider.stage) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `a rider at stage ${rider.stage} cannot include stage ${stage} in its base; only earlier stages are available`,
          path: ['base', 'includeStages', index],
        });
      }
    }
  });
export type Rider = z.infer<typeof Rider>;

export type PercentRider = Extract<Rider, { basis: 'percent-of-subtotal' }>;
