import { estimateLoadProfile, type LoadShapeEstimate } from '@boring/load-shape-estimator';
import { readCachedExtraction } from './extraction-storage';
import { readCachedEstimate, writeCachedEstimate } from './estimate-storage';
import { billToEstimatorInput } from './usage-estimate';

/** Shared between /usage and /report — both need "the estimated profile for
 * this confirmed bill, computed or read from cache." */
export type BillEstimate =
  | { filename: string; status: 'ok'; estimate: LoadShapeEstimate }
  | { filename: string; status: 'error'; message: string };

export async function getOrEstimateBill(uploadId: string, filename: string): Promise<BillEstimate> {
  const cached = await readCachedEstimate(uploadId, filename);
  if (cached !== null) return { filename, status: 'ok', estimate: cached };

  const bill = await readCachedExtraction(uploadId, filename);
  if (bill === null) {
    return { filename, status: 'error', message: 'No confirmed extraction found for this bill.' };
  }

  const converted = billToEstimatorInput(bill);
  if (!converted.ok) {
    return { filename, status: 'error', message: converted.reason };
  }

  try {
    const estimate = estimateLoadProfile(converted.input);
    await writeCachedEstimate(uploadId, filename, estimate);
    return { filename, status: 'ok', estimate };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { filename, status: 'error', message };
  }
}
