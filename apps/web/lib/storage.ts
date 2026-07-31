import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { storageBackend } from './storage-backend';

/**
 * Upload storage for the beta pipeline, keyed by a random upload id. No
 * database, no accounts — this is the smallest thing that lets an upload
 * survive across the request boundary between the upload step and the
 * confirmation/report steps that follow it. `uploadDir` returns a logical
 * key prefix, not a filesystem path — see storage-backend.ts for where that
 * prefix actually lands (local disk in dev, Vercel Blob in production).
 */

export function uploadDir(id: string): string {
  // id always comes from randomUUID() (see createUpload) or is validated by
  // isValidUploadId before being used to build a key — never taken raw from
  // a URL param without that check.
  return `uploads/${id}`;
}

export function isValidUploadId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

/** Strips any directory components so a crafted filename can't escape the
 * upload's own folder. */
function safeName(originalName: string, index: number): string {
  const base = path.basename(originalName).replace(/[^\w.\-]+/g, '_');
  return base.length > 0 ? `${index}-${base}` : `${index}-file`;
}

export interface UploadManifest {
  id: string;
  bills: string[];
  greenButton: string[];
}

export async function createUpload(bills: File[], greenButton: File[]): Promise<string> {
  const id = randomUUID();
  const backend = storageBackend();
  const dir = uploadDir(id);

  await Promise.all([
    ...bills.map(async (file, index) => {
      const buf = Buffer.from(await file.arrayBuffer());
      await backend.write(`${dir}/bills/${safeName(file.name, index)}`, buf);
    }),
    ...greenButton.map(async (file, index) => {
      const buf = Buffer.from(await file.arrayBuffer());
      await backend.write(`${dir}/greenbutton/${safeName(file.name, index)}`, buf);
    }),
  ]);

  return id;
}

export async function readManifest(id: string): Promise<UploadManifest | null> {
  const backend = storageBackend();
  const dir = uploadDir(id);
  const [bills, greenButton] = await Promise.all([
    backend.list(`${dir}/bills`),
    backend.list(`${dir}/greenbutton`),
  ]);
  // Every real upload has at least one bill (submitUpload rejects an empty
  // one before createUpload ever runs) — no bills means no such upload.
  if (bills.length === 0) return null;
  return { id, bills: bills.sort(), greenButton: greenButton.sort() };
}

export async function readBillFile(id: string, filename: string): Promise<Buffer | null> {
  return storageBackend().read(`${uploadDir(id)}/bills/${filename}`);
}
