import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Upload storage for the beta pipeline: plain files on local disk, keyed by a
 * random upload id. No database, no accounts — this is the smallest thing
 * that lets an upload survive across the request boundary between the upload
 * step and the confirmation/report steps that follow it.
 */

function uploadsRoot(): string {
  return path.join(process.cwd(), '.data', 'uploads');
}

export function uploadDir(id: string): string {
  // id always comes from randomUUID() (see createUpload) or is validated by
  // isValidUploadId before being used to build a path — never taken raw from
  // a URL param without that check.
  return path.join(uploadsRoot(), id);
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
  const dir = uploadDir(id);
  await mkdir(path.join(dir, 'bills'), { recursive: true });
  await mkdir(path.join(dir, 'greenbutton'), { recursive: true });

  await Promise.all([
    ...bills.map(async (file, index) => {
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(dir, 'bills', safeName(file.name, index)), buf);
    }),
    ...greenButton.map(async (file, index) => {
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(dir, 'greenbutton', safeName(file.name, index)), buf);
    }),
  ]);

  return id;
}

export async function readManifest(id: string): Promise<UploadManifest | null> {
  const dir = uploadDir(id);
  try {
    await stat(dir);
  } catch {
    return null;
  }
  const [bills, greenButton] = await Promise.all([
    readdir(path.join(dir, 'bills')).catch(() => []),
    readdir(path.join(dir, 'greenbutton')).catch(() => []),
  ]);
  return { id, bills: bills.sort(), greenButton: greenButton.sort() };
}
