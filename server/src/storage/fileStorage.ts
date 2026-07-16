import fs from 'node:fs';
import path from 'node:path';

/**
 * Uploaded-file storage abstraction. The local implementation writes to the
 * ./uploads directory; swapping to Azure Blob Storage means providing another
 * implementation of this interface (see createFileStorage) — controllers and
 * services never touch the filesystem directly.
 */
export interface FileStorage {
  /** Store bytes under a key; returns the key. */
  put(key: string, data: Buffer): Promise<string>;
  /** Read bytes back; throws if missing. */
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class LocalFileStorage implements FileStorage {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private resolve(key: string): string {
    // Keys are opaque file names — refuse anything that escapes the directory.
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<string> {
    await fs.promises.writeFile(this.resolve(key), data);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return fs.promises
      .access(this.resolve(key))
      .then(() => true)
      .catch(() => false);
  }
}

/** Factory — replace the implementation here to move to Azure Blob Storage. */
export function createFileStorage(uploadsDir: string): FileStorage {
  return new LocalFileStorage(uploadsDir);
}
