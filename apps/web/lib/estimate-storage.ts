import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LoadShapeEstimate } from '@boring/load-shape-estimator';
import { uploadDir } from './storage';

/** Estimates are cached per bill, same pattern as extraction-storage.ts —
 * the estimator is deterministic, so re-running it would always produce the
 * identical result anyway; caching just avoids redoing the (cheap but not
 * free) work on every page load. */

function estimatesDir(uploadId: string): string {
  return path.join(uploadDir(uploadId), 'estimates');
}

function estimatePath(uploadId: string, billFilename: string): string {
  return path.join(estimatesDir(uploadId), `${billFilename}.json`);
}

export async function readCachedEstimate(uploadId: string, billFilename: string): Promise<LoadShapeEstimate | null> {
  try {
    const raw = await readFile(estimatePath(uploadId, billFilename), 'utf8');
    return LoadShapeEstimate.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCachedEstimate(
  uploadId: string,
  billFilename: string,
  estimate: LoadShapeEstimate,
): Promise<void> {
  await mkdir(estimatesDir(uploadId), { recursive: true });
  await writeFile(estimatePath(uploadId, billFilename), JSON.stringify(estimate, null, 2));
}
