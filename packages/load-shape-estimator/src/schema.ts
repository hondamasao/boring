import { z } from 'zod';
import { LoadProfile } from '@boring/tariff-schema';

export const LoadShapeEstimateMethod = z.enum(['fit-energy-and-peak', 'fit-energy-only']);
export type LoadShapeEstimateMethod = z.infer<typeof LoadShapeEstimateMethod>;

export const LoadShapeEstimate = z
  .object({
    profile: LoadProfile,
    method: LoadShapeEstimateMethod,
    /** What the fitted shape's own peak interval works out to, in kW — for
     * cross-checking against the bill's stated demand even when the method
     * didn't (or couldn't) fit to it directly. */
    impliedPeakKw: z.number(),
    assumptions: z.array(z.string()),
    disclaimer: z.string().min(1),
  })
  .strict();
export type LoadShapeEstimate = z.infer<typeof LoadShapeEstimate>;
