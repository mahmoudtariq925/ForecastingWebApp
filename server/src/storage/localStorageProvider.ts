// ============================================================================
// LocalStorageProvider — a filesystem implementation of StorageProvider that
// deliberately mirrors Azure Blob Storage. Each collection is a folder; JSON
// documents are `<collection>/<name>.json`; uploaded files are binary blobs
// under `<collection>/uploads/<name>`, e.g.:
//
//   storage/
//     users/users.json
//     entities/entities.json
//     cycles/cycles.json
//     settings/settings.json
//     submissions/submissions.json
//     approvals/approvals.json
//     variances/variances.json
//     templates/templates.json
//     templates/uploads/<templateId>.xlsx
//
// Nothing above this class knows about the filesystem.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import type { StorageProvider } from './storageProvider.js';

export class LocalStorageProvider implements StorageProvider {
  constructor(private baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  /** Resolve a path under the base dir, rejecting traversal outside it. */
  private resolve(...segments: string[]): string {
    const safe = segments.map((s) => this.sanitize(s));
    const full = path.resolve(this.baseDir, ...safe);
    const root = path.resolve(this.baseDir) + path.sep;
    if (full !== path.resolve(this.baseDir) && !full.startsWith(root)) {
      throw new Error(`Invalid storage path: ${segments.join('/')}`);
    }
    return full;
  }

  private sanitize(segment: string): string {
    if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
      throw new Error(`Invalid storage segment: ${segment}`);
    }
    return segment;
  }

  private jsonPath(collection: string, name: string): string {
    return this.resolve(collection, `${name}.json`);
  }

  private blobPath(collection: string, name: string): string {
    return this.resolve(collection, 'uploads', name);
  }

  async readJson<T>(collection: string, name: string): Promise<T | null> {
    try {
      const raw = await fs.promises.readFile(this.jsonPath(collection, name), 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeJson<T>(collection: string, name: string, value: T): Promise<void> {
    const file = this.jsonPath(collection, name);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    // Write atomically so a crash mid-write can't corrupt the document.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);
  }

  async putBlob(collection: string, name: string, data: Buffer): Promise<void> {
    const file = this.blobPath(collection, name);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, data);
  }

  async getBlob(collection: string, name: string): Promise<Buffer> {
    return fs.promises.readFile(this.blobPath(collection, name));
  }

  async deleteBlob(collection: string, name: string): Promise<void> {
    await fs.promises.rm(this.blobPath(collection, name), { force: true });
  }

  async blobExists(collection: string, name: string): Promise<boolean> {
    return fs.promises
      .access(this.blobPath(collection, name))
      .then(() => true)
      .catch(() => false);
  }
}
