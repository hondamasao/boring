import { z } from 'zod';
import { Citation, Component, Identifier, Rate } from './primitives.js';

/**
 * One block of a block-rate (tiered) energy charge.
 *
 * `upToKwh` is the block's upper bound, cumulative from zero. Exactly one tier
 * has `upToKwh: null`, meaning unbounded, and it must be last.
 *
 * NOTE: these are generic block-rate tiers. This is deliberately NOT SCE's
 * residential baseline credit, which is a per-kWh credit against usage under a
 * zone- and season-dependent allowance — a structurally different mechanism.
 * Residential (TOU-D) is out of scope, and modelling one as the other would
 * produce plausible, wrong numbers. Tiers are expected to be UNUSED on
 * TOU-GS-2; the field exists for other utilities later.
 */
export const Tier = z
  .object({
    upToKwh: z.number().positive().nullable(),
    ratePerKwh: Rate,
  })
  .strict();
export type Tier = z.infer<typeof Tier>;

/**
 * How tier boundaries are consumed.
 *  - `this-charge`: blocks apply to this charge's kWh alone.
 *  - `billing-period-total`: blocks are consumed from one running total shared
 *    across every charge that declares this basis, ordered by season then by
 *    TOU period rank so the order is a property of the tariff, not of the JSON.
 */
export const TierBasis = z.enum(['this-charge', 'billing-period-total']);
export type TierBasis = z.infer<typeof TierBasis>;

/**
 * Flat or tiered, never both. A discriminated union rather than an optional
 * `tiers` alongside a `ratePerKwh` — with both present there would be no
 * written-down answer to which one wins.
 */
export const EnergyPricing = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('flat'),
        ratePerKwh: Rate,
      })
      // Strict so that `tiers` alongside a flat rate is an error rather than a
      // silently dropped key — otherwise the document reads as tiered and bills
      // as flat.
      .strict(),
    z
      .object({
        kind: z.literal('tiered'),
        tierBasis: TierBasis,
        tiers: z.array(Tier).min(1),
      })
      .strict(),
  ])
  // Refined on the union rather than the member: zod's discriminated union needs
  // plain object members to read the discriminator.
  .superRefine((p, ctx) => {
    if (p.kind !== 'tiered') return;
    let previous = 0;
    for (const [index, tier] of p.tiers.entries()) {
      const isLast = index === p.tiers.length - 1;
      if (tier.upToKwh === null) {
        if (!isLast) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'only the last tier may be unbounded (upToKwh: null)',
            path: ['tiers', index, 'upToKwh'],
          });
        }
        continue;
      }
      if (isLast) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'the last tier must be unbounded (upToKwh: null) so all usage is priced',
          path: ['tiers', index, 'upToKwh'],
        });
      }
      if (tier.upToKwh <= previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tier bounds must strictly increase; ${tier.upToKwh} follows ${previous}`,
          path: ['tiers', index, 'upToKwh'],
        });
      }
      previous = tier.upToKwh;
    }
  });
export type EnergyPricing = z.infer<typeof EnergyPricing>;

/** A per-kWh charge for one (season, TOU period, component) combination. */
export const EnergyCharge = z
  .object({
    id: Identifier,
    label: z.string().min(1),
    seasonId: Identifier,
    periodId: Identifier,
    component: Component,
    pricing: EnergyPricing,
    citation: Citation,
  })
  .strict();
export type EnergyCharge = z.infer<typeof EnergyCharge>;
