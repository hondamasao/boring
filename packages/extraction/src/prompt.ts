/**
 * The tool schema the model is forced to call. Hand-written to mirror
 * `ExtractedBill` (schema.ts) field-for-field rather than generated from the
 * Zod schema — the duplication is small and keeping them separate means a
 * change to one doesn't silently reshape the other; `ExtractedBill.parse`
 * still re-validates the model's actual output, so this schema is a prompt,
 * not the source of truth.
 */

function fieldSchema(valueType: 'string' | 'number', description: string) {
  return {
    type: 'object' as const,
    properties: {
      value: { type: [valueType, 'null'], description },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '0 = not found or a pure guess, 1 = printed clearly and unambiguously on the bill.',
      },
      evidence: {
        type: ['string', 'null'],
        description: 'A short verbatim quote from the bill supporting this value. Null only if value is null.',
      },
    },
    required: ['value', 'confidence', 'evidence'],
  };
}

export const EXTRACTION_TOOL_NAME = 'record_bill_extraction';

export const EXTRACTION_TOOL = {
  name: EXTRACTION_TOOL_NAME,
  description:
    'Records the values read off a Southern California Edison (SCE) commercial electricity bill. Every field needs a confidence score and a supporting quote. Never fabricate a value: if a field cannot be found or read with confidence, set its value to null, its confidence to 0, and its evidence to null.',
  input_schema: {
    type: 'object' as const,
    properties: {
      billingPeriod: {
        type: 'object' as const,
        properties: {
          start: fieldSchema('string', 'Billing period start date, ISO 8601 (YYYY-MM-DD).'),
          end: fieldSchema('string', 'Billing period end date, ISO 8601 (YYYY-MM-DD).'),
        },
        required: ['start', 'end'],
      },
      rateSchedule: fieldSchema(
        'string',
        'The rate schedule / tariff code printed on the bill, exactly as printed — e.g. "TOU-GS-2", "TOU-GS-2-D", "TOU-GS-2 Option D". Do not normalize or guess which option letter it is if the bill does not print one.',
      ),
      totalKwh: fieldSchema('number', 'Total kWh (energy) used in the billing period.'),
      totalDemandKw: fieldSchema(
        'number',
        'Total (maximum / billed) demand in kW for the billing period. Many small commercial bills have no demand charge at all — if there is no demand line on the bill, this is a genuine null, not a missed read.',
      ),
      totalAmount: fieldSchema('number', 'The total dollar amount due on the bill for this billing period.'),
      extractionNotes: {
        type: ['string', 'null'],
        description:
          'Anything unusual worth a human knowing: illegible sections, more than one rate schedule on the bill, a Direct Access/CCA bill where generation is billed by a separate supplier, an estimated (not actual) meter read, etc. Null if nothing notable.',
      },
    },
    required: ['billingPeriod', 'rateSchedule', 'totalKwh', 'totalDemandKw', 'totalAmount', 'extractionNotes'],
  },
};

export const SYSTEM_PROMPT = `You read Southern California Edison (SCE) commercial electricity bills and extract a fixed set of fields via the ${EXTRACTION_TOOL_NAME} tool.

Rules:
- Only report what is actually printed on the bill. Do not infer, normalize, or compute a value that isn't directly stated.
- If you are not confident in a field, or cannot find it at all, set its value to null and confidence to 0 rather than guessing. A missing field is far better than a wrong one — someone will manually fill it in.
- Quote the exact text you relied on for each non-null field in "evidence".
- SCE commercial rate schedules include TOU-GS-1, TOU-GS-2, TOU-GS-3, and TOU-8, sometimes suffixed with an option letter (e.g. "-D", "-E") or "Option D" / "Option E" spelled out. Transcribe the code exactly as printed; do not guess an option letter the bill doesn't print.
- Many small commercial bills have no demand charge line at all — that is a real null for totalDemandKw, not a failure to find it.
- If the bill separates Delivery and Generation (common for Direct Access or Community Choice Aggregation customers), totalAmount is still the single bottom-line amount due; note the split in extractionNotes.`;
