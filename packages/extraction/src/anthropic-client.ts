import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_TOOL, EXTRACTION_TOOL_NAME, SYSTEM_PROMPT } from './prompt.js';
import { ExtractionError } from './schema.js';

/**
 * A model call takes bill PDF bytes and returns whatever JSON the model
 * produced for the extraction tool — unvalidated. `extractBill` (extract.ts)
 * is the only caller and always runs the result through `ExtractedBill.parse`
 * before anyone sees it. Callers inject this function in tests so the rest of
 * the package's logic (schema validation, error handling) can be exercised
 * with zero network calls.
 */
export type ModelCaller = (pdfBytes: Uint8Array) => Promise<unknown>;

const DEFAULT_MODEL = 'claude-sonnet-5';

export function defaultModelCaller(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): ModelCaller {
  return async (pdfBytes) => {
    if (!apiKey) {
      throw new ExtractionError(
        'ANTHROPIC_API_KEY is not set — packages/extraction cannot call the model without it.',
      );
    }

    const client = new Anthropic({ apiKey });
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            {
              type: 'text',
              text: `Extract the fields defined by the ${EXTRACTION_TOOL_NAME} tool from this SCE electricity bill.`,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (toolUse === undefined) {
      throw new ExtractionError(
        `Model did not call ${EXTRACTION_TOOL_NAME} — stop_reason was "${response.stop_reason}".`,
      );
    }
    return toolUse.input;
  };
}
