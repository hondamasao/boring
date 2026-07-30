import { z } from 'zod';
import { IsoDate, IsoInstant } from './primitives.js';

/**
 * Where a tariff record came from and when a human last checked it.
 *
 * CLAUDE.md #4: tariff records are versioned and immutable. A record is
 * superseded, never edited in place, so a 2025 bill is always rated with 2025
 * rates. `supersededDate` is what makes that enforceable — a null value means
 * "currently in effect", and the tariff library can assert that effective
 * windows for one schedule never overlap.
 */
export const Provenance = z
  .object({
    /** Direct link to the tariff sheet PDF, not a landing page. */
    sourceUrl: z.string().url(),

    /**
     * The sheet's own revision identifier, e.g.
     * "Revised Cal. PUC Sheet No. 74764-E". This is the string a bill dispute
     * would cite, so it is required and free-form rather than parsed.
     */
    sheetRevision: z.string().min(1),

    /** First service date this record applies to, inclusive. */
    effectiveDate: IsoDate,

    /** First service date this record no longer applies to, exclusive.
     * Null means currently in effect. */
    supersededDate: IsoDate.nullable(),

    /** When a human last compared this record against the source PDF. */
    verifiedAt: IsoInstant,

    verifiedBy: z.string().min(1).optional(),

    /** Anything a later reader needs to know: ambiguous sheet wording, a value
     * read off a footnote, a figure that disagrees with URDB. */
    transcriptionNotes: z.string().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.supersededDate !== null && p.supersededDate <= p.effectiveDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `supersededDate (${p.supersededDate}) must be after effectiveDate (${p.effectiveDate})`,
        path: ['supersededDate'],
      });
    }
  });

export type Provenance = z.infer<typeof Provenance>;
