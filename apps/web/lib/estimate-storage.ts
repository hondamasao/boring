import { LoadShapeEstimate } from '@boring/load-shape-estimator';
import { uploadDir } from './storage';
import { storageBackend } from './storage-backend';

/** Estimates are cached per bill, same pattern as extraction-storage.ts —
 * the estimator is deterministic, so re-running it would always produce the
 * identical result anyway; caching just avoids redoing the (cheap but not
 * free) work on every page load. */

function estimateKey(uploadId: string, billFilename: string): string {
  return `${uploadDir(uploadId)}/estimates/${billFilename}.json`;
}

export async function readCachedEstimate(uploadId: string, billFilename: string): Promise<LoadShapeEstimate | null> {
  const raw = await storageBackend().read(estimateKey(uploadId, billFilename));
  if (raw === null) return null;
  try {
    return LoadShapeEstimate.parse(JSON.parse(raw.toString('utf8')));
  } catch {
    return null;
  }
}

export async function writeCachedEstimate(
  uploadId: string,
  billFilename: string,
  estimate: LoadShapeEstimate,
): Promise<void> {
  await storageBackend().write(estimateKey(uploadId, billFilename), Buffer.from(JSON.stringify(estimate, null, 2)));
}
