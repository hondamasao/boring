import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExtractedBill } from '@boring/extraction';
import { uploadDir } from './storage';

/**
 * Extraction results, cached to disk per bill so a page reload doesn't
 * re-run (and re-pay for) the model call. Only successful extractions are
 * cached — a failure isn't persisted, so a transient error (rate limit,
 * timeout) is retried on the next page load rather than stuck forever.
 */

function extractionsDir(uploadId: string): string {
  return path.join(uploadDir(uploadId), 'extractions');
}

function extractionPath(uploadId: string, billFilename: string): string {
  return path.join(extractionsDir(uploadId), `${billFilename}.json`);
}

export async function readCachedExtraction(uploadId: string, billFilename: string): Promise<ExtractedBill | null> {
  try {
    const raw = await readFile(extractionPath(uploadId, billFilename), 'utf8');
    return ExtractedBill.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCachedExtraction(
  uploadId: string,
  billFilename: string,
  result: ExtractedBill,
): Promise<void> {
  await mkdir(extractionsDir(uploadId), { recursive: true });
  await writeFile(extractionPath(uploadId, billFilename), JSON.stringify(result, null, 2));
}

export interface ConfirmationRecord {
  confirmedAt: string;
  bills: string[];
}

function confirmationPath(uploadId: string): string {
  return path.join(uploadDir(uploadId), 'confirmed.json');
}

export async function writeConfirmation(uploadId: string, bills: string[]): Promise<void> {
  const record: ConfirmationRecord = { confirmedAt: new Date().toISOString(), bills };
  await writeFile(confirmationPath(uploadId), JSON.stringify(record, null, 2));
}

export async function readConfirmation(uploadId: string): Promise<ConfirmationRecord | null> {
  try {
    const raw = await readFile(confirmationPath(uploadId), 'utf8');
    return JSON.parse(raw) as ConfirmationRecord;
  } catch {
    return null;
  }
}
