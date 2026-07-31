import { z } from 'zod';

/**
 * Every extracted value carries its own confidence and supporting quote —
 * there is no path from a raw model guess to a trusted number. `value` is
 * nullable on purpose: CLAUDE.md invariant #6 is "a model that declines to
 * guess is better than one that guesses wrong," so a field the model can't
 * read confidently must come back null with confidence 0, not a fabricated
 * number with confidence dialed down.
 */
function extractedField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
  });
}

export const ExtractedTextField = extractedField(z.string());
export const ExtractedNumberField = extractedField(z.number());
export type ExtractedField<T> = { value: T | null; confidence: number; evidence: string | null };

export const ExtractedBill = z.object({
  billingPeriod: z.object({
    start: ExtractedTextField,
    end: ExtractedTextField,
  }),
  rateSchedule: ExtractedTextField,
  totalKwh: ExtractedNumberField,
  totalDemandKw: ExtractedNumberField,
  totalAmount: ExtractedNumberField,
  /** Free text for anything that doesn't fit a field: illegible sections,
   * a Direct Access/CCA bill where generation is billed separately, an
   * estimated (not actual) read, multiple schedules on one bill, etc. */
  extractionNotes: z.string().nullable(),
});
export type ExtractedBill = z.infer<typeof ExtractedBill>;

export class ExtractionError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}
