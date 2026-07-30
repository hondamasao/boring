import { z } from 'zod';
import { Citation, Identifier } from './primitives.js';

/**
 * Which demand charge a ratchet floors. Discriminated on the same `kind`
 * literal the charge itself carries, so a ratchet cannot point at a facilities
 * charge while claiming to be time-related — validation resolves the id inside
 * the matching family only.
 */
export const RatchetTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('facilities'), chargeId: Identifier }).strict(),
  z.object({ kind: z.literal('time-related'), chargeId: Identifier }).strict(),
]);
export type RatchetTarget = z.infer<typeof RatchetTarget>;

/**
 * A demand ratchet: a prior month's peak setting a floor under a later month's
 * billed demand.
 *
 *   floor     = percentOfPriorPeak x max(qualifying prior peaks)
 *   billed kW = max(this period's measured peak, floor)
 *
 * Prior peaks are an EXPLICIT ENGINE INPUT (`DemandHistory`), never fetched —
 * the money path makes no network calls.
 *
 * Every parameter is data because SCE's ratchet provisions differ by schedule:
 * the percentage, the lookback length, and whether a summer peak can floor a
 * winter month are all read off the sheet. Ratchets appear to be more common on
 * TOU-8, standby and transmission-level schedules than on TOU-GS-2; a schedule
 * with none carries `ratchets: []`, which is a statement about the sheet rather
 * than an unimplemented feature.
 */
export const DemandRatchet = z
  .object({
    id: Identifier,
    label: z.string().min(1),
    appliesTo: RatchetTarget,

    /** How many months before the current billing month are in the window. */
    lookbackMonths: z.number().int().positive().max(120),

    /** Fraction of the qualifying prior peak that becomes the floor, e.g. 0.5. */
    percentOfPriorPeak: z.number().min(0).max(1),

    /**
     * `any-season`: any month in the window can set the floor.
     * `same-season-only`: only months in the same season as the determination.
     */
    seasonScope: z.enum(['any-season', 'same-season-only']),

    citation: Citation,
  })
  .strict();
export type DemandRatchet = z.infer<typeof DemandRatchet>;
