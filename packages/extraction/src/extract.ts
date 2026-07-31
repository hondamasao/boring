import { defaultModelCaller, type ModelCaller } from './anthropic-client.js';
import { ExtractedBill, ExtractionError } from './schema.js';

/**
 * Bill PDF bytes -> validated `ExtractedBill`. This is the whole package's
 * public surface: the model's raw JSON always passes through
 * `ExtractedBill.parse` before a caller sees it, so a malformed or
 * off-schema model response fails loudly here rather than reaching the
 * confirm screen looking like real data.
 */
export async function extractBill(
  pdfBytes: Uint8Array,
  callModel: ModelCaller = defaultModelCaller(),
): Promise<ExtractedBill> {
  const raw = await callModel(pdfBytes);
  const parsed = ExtractedBill.safeParse(raw);
  if (!parsed.success) {
    throw new ExtractionError('Model output did not match the expected extraction schema.', parsed.error);
  }
  return parsed.data;
}
