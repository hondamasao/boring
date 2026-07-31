/**
 * All tests inject a fake `ModelCaller` — no network call, no API key, fully
 * deterministic. What's under test is the package's OWN behavior: that a
 * well-formed model response comes back as a validated `ExtractedBill`, that
 * a malformed one fails loudly instead of reaching a caller half-parsed, and
 * that "the model declined to guess" (null value, 0 confidence) is treated
 * as a normal, valid result rather than an error.
 */
import { describe, expect, it } from 'vitest';
import { extractBill, ExtractionError } from '../src/index.js';

function wellFormedResponse() {
  return {
    billingPeriod: {
      start: { value: '2026-06-01', confidence: 0.95, evidence: 'Billing Period: 06/01/26 - 06/30/26' },
      end: { value: '2026-06-30', confidence: 0.95, evidence: 'Billing Period: 06/01/26 - 06/30/26' },
    },
    rateSchedule: { value: 'TOU-GS-2-D', confidence: 0.9, evidence: 'Rate Schedule: TOU-GS-2-D' },
    totalKwh: { value: 5200, confidence: 0.99, evidence: 'Total kWh: 5,200' },
    totalDemandKw: { value: 42, confidence: 0.8, evidence: 'Billed Demand: 42 kW' },
    totalAmount: { value: 1310.55, confidence: 0.99, evidence: 'Total Amount Due: $1,310.55' },
    extractionNotes: null,
  };
}

describe('extractBill', () => {
  it('returns a validated ExtractedBill for a well-formed model response', async () => {
    const result = await extractBill(new Uint8Array([0]), async () => wellFormedResponse());
    expect(result.rateSchedule.value).toBe('TOU-GS-2-D');
    expect(result.totalKwh.value).toBe(5200);
    expect(result.totalAmount).toEqual({ value: 1310.55, confidence: 0.99, evidence: 'Total Amount Due: $1,310.55' });
  });

  it('accepts a field the model declined to guess: null value, 0 confidence, null evidence', async () => {
    const response = wellFormedResponse();
    response.totalDemandKw = { value: null as unknown as number, confidence: 0, evidence: null as unknown as string };
    const result = await extractBill(new Uint8Array([0]), async () => response);
    expect(result.totalDemandKw).toEqual({ value: null, confidence: 0, evidence: null });
  });

  it('throws ExtractionError, not a silent partial result, when a required field is missing', async () => {
    const response = wellFormedResponse();
    // @ts-expect-error deliberately malformed for the test
    delete response.totalAmount;
    await expect(extractBill(new Uint8Array([0]), async () => response)).rejects.toThrow(ExtractionError);
  });

  it('throws ExtractionError when confidence is outside [0, 1]', async () => {
    const response = wellFormedResponse();
    response.totalKwh.confidence = 1.5;
    await expect(extractBill(new Uint8Array([0]), async () => response)).rejects.toThrow(ExtractionError);
  });

  it('throws ExtractionError when the model returns something that is not an object at all', async () => {
    await expect(extractBill(new Uint8Array([0]), async () => 'not json')).rejects.toThrow(ExtractionError);
  });

  it('propagates errors the model caller itself throws (e.g. missing API key)', async () => {
    const boom = new ExtractionError('ANTHROPIC_API_KEY is not set');
    await expect(
      extractBill(new Uint8Array([0]), async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it('never invents evidence for a null value', async () => {
    const response = wellFormedResponse();
    response.totalDemandKw = { value: null as unknown as number, confidence: 0, evidence: 'this should not happen but is still schema-valid' };
    // The schema allows evidence alongside a null value (it doesn't enforce
    // the pairing) — this test documents that the pairing is a prompt-level
    // instruction, not a schema-level guarantee, so a reviewer UI can't
    // blindly assume evidence implies a non-null value.
    const result = await extractBill(new Uint8Array([0]), async () => response);
    expect(result.totalDemandKw.value).toBeNull();
  });
});
