import { z } from 'zod';
import { Citation, Component, Identifier, Rate } from './primitives.js';

/**
 * A power-factor adjustment on demand.
 *
 * The INPUT shape is settled now — `LoadProfile` readings carry optional
 * `kvarh` / `kva` — so whether a given schedule has a PF clause is a data
 * question rather than a breaking change to the engine's signature.
 *
 * Only one method is modelled: a charge per kVAR of reactive demand in excess of
 * what the threshold power factor allows. That form is generic, not transcribed
 * from an SCE sheet. It is NOT confirmed to be how SCE words its PF clause, so
 * TOU-GS-2 carries `powerFactorAdjustment: null` until the sheet is read. If the
 * sheet turns out to use a demand multiplier or a percentage adjustment instead,
 * that becomes a second member of this union — deliberately absent rather than
 * guessed, because a plausible guess here would pass tests and be wrong on a
 * real bill.
 */
export const PowerFactorAdjustment = z
  .object({
    id: Identifier,
    label: z.string().min(1),
    component: Component,

    method: z.literal('per-kvar-below-threshold'),

    /** Power factor at or above which no adjustment applies, e.g. 0.85. */
    thresholdPowerFactor: z.number().gt(0).lte(1),

    /**
     * Charge per kVAR of billable reactive demand, where
     *   billable kVAR = max(0, peak kVAR - peak kW x tan(acos(threshold)))
     * evaluated over the same metered windows as the demand charges.
     */
    ratePerKvar: Rate,

    citation: Citation,
  })
  .strict();
export type PowerFactorAdjustment = z.infer<typeof PowerFactorAdjustment>;

/** Reactive demand allowed at the threshold power factor for a given real demand. */
export function allowedKvarAt(peakKw: number, thresholdPowerFactor: number): number {
  return peakKw * Math.tan(Math.acos(thresholdPowerFactor));
}
