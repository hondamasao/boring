import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Everything above this line reads/writes a customer's bill PDFs and every
 * downstream artifact built from them (extractions, estimates, confirmation
 * records) through this one seam. Locally (and in this dev/test
 * environment) that's plain files on disk — Vercel's serverless functions
 * have no shared disk, so production routes through Vercel Blob instead,
 * selected automatically by whether `BLOB_READ_WRITE_TOKEN` is set (Vercel
 * sets this itself once Blob storage is connected to the project; nothing
 * to configure by hand). Every write uses `access: 'private'` — these are
 * a stranger's real bill PDFs, never a public URL.
 */
export interface StorageBackend {
  write(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  /** Direct children of `prefix` only (matches `readdir`, not a recursive walk). */
  list(prefix: string): Promise<string[]>;
}

class LocalFsBackend implements StorageBackend {
  private root(): string {
    return path.join(/* turbopackIgnore: true */ process.cwd(), '.data');
  }

  async write(key: string, data: Buffer): Promise<void> {
    const full = path.join(this.root(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(path.join(this.root(), key));
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      return await readdir(path.join(this.root(), prefix));
    } catch {
      return [];
    }
  }
}

class VercelBlobBackend implements StorageBackend {
  async write(key: string, data: Buffer): Promise<void> {
    const { put } = await import('@vercel/blob');
    await put(key, data, { access: 'private', addRandomSuffix: false, allowOverwrite: true });
  }

  async read(key: string): Promise<Buffer | null> {
    const { get } = await import('@vercel/blob');
    const result = await get(key, { access: 'private' });
    if (result === null || result.stream === null) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async list(prefix: string): Promise<string[]> {
    const { list } = await import('@vercel/blob');
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const { blobs } = await list({ prefix: normalized });
    // Our keys are never nested more than one level below any prefix we list
    // (e.g. `uploads/<id>/bills/<filename>`, never `.../bills/sub/<filename>`)
    // — the `!includes('/')` guard makes that an enforced invariant instead
    // of an assumption, matching readdir()'s non-recursive semantics exactly.
    return blobs.map((b) => b.pathname.slice(normalized.length)).filter((name) => name.length > 0 && !name.includes('/'));
  }
}

let backend: StorageBackend | null = null;

export function storageBackend(): StorageBackend {
  if (backend === null) {
    backend = process.env.BLOB_READ_WRITE_TOKEN ? new VercelBlobBackend() : new LocalFsBackend();
  }
  return backend;
}
