// ============================================================================
// FileStorage — a generalized façade for physical files (uploaded template
// workbooks). It is backed by the active StorageProvider's blob operations, so
// the application never cares where files physically live: today the local
// `templates/uploads/` folder or a SQLite blob table, tomorrow an Azure Blob
// container. Only the StorageProvider implementation changes.
// ============================================================================
import type { StorageProvider } from './storageProvider.js';

export interface FileStorage {
  /** Store bytes under a key; returns the key. */
  put(key: string, data: Buffer): Promise<string>;
  /** Read bytes back; rejects if missing. */
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Build a FileStorage over a StorageProvider. Files are stored as blobs in the
 * given collection (default `templates` → `templates/uploads/...` locally).
 */
export function createFileStorage(provider: StorageProvider, collection = 'templates'): FileStorage {
  return {
    async put(key, data) {
      await provider.putBlob(collection, key, data);
      return key;
    },
    get: (key) => provider.getBlob(collection, key),
    delete: (key) => provider.deleteBlob(collection, key),
    exists: (key) => provider.blobExists(collection, key),
  };
}
