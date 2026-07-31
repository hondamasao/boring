import { ExtractedBill } from '@boring/extraction';
import { uploadDir } from './storage';
import { storageBackend } from './storage-backend';

/**
 * Extraction results, cached per bill so a page reload doesn't re-run (and
 * re-pay for) the model call. Only successful extractions are cached — a
 * failure isn't persisted, so a transient error (rate limit, timeout) is
 * retried on the next page load rather than stuck forever.
 */

function extractionKey(uploadId: string, billFilename: string): string {
  return `${uploadDir(uploadId)}/extractions/${billFilename}.json`;
}

export async function readCachedExtraction(uploadId: string, billFilename: string): Promise<ExtractedBill | null> {
  const raw = await storageBackend().read(extractionKey(uploadId, billFilename));
  if (raw === null) return null;
  try {
    return ExtractedBill.parse(JSON.parse(raw.toString('utf8')));
  } catch {
    return null;
  }
}

export async function writeCachedExtraction(
  uploadId: string,
  billFilename: string,
  result: ExtractedBill,
): Promise<void> {
  await storageBackend().write(extractionKey(uploadId, billFilename), Buffer.from(JSON.stringify(result, null, 2)));
}

export interface ConfirmationRecord {
  confirmedAt: string;
  bills: string[];
}

function confirmationKey(uploadId: string): string {
  return `${uploadDir(uploadId)}/confirmed.json`;
}

export async function writeConfirmation(uploadId: string, bills: string[]): Promise<void> {
  const record: ConfirmationRecord = { confirmedAt: new Date().toISOString(), bills };
  await storageBackend().write(confirmationKey(uploadId), Buffer.from(JSON.stringify(record, null, 2)));
}

export async function readConfirmation(uploadId: string): Promise<ConfirmationRecord | null> {
  const raw = await storageBackend().read(confirmationKey(uploadId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw.toString('utf8')) as ConfirmationRecord;
  } catch {
    return null;
  }
}
