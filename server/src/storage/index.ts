// Storage provider factory — the single place that decides which physical
// backend persistence runs on. To add Azure Blob Storage: implement
// AzureBlobStorageProvider (StorageProvider) and return it for 'azure-blob'.
import type { StorageProvider } from './storageProvider.js';
import { LocalStorageProvider } from './localStorageProvider.js';
import { SqliteStorageProvider } from './sqliteStorageProvider.js';
import { config } from '../config.js';

export type { StorageProvider } from './storageProvider.js';
export { createFileStorage, type FileStorage } from './fileStorage.js';

export function createStorageProvider(): StorageProvider {
  switch (config.storageProvider) {
    case 'sqlite':
      return new SqliteStorageProvider(config.sqlitePath);
    case 'azure-blob':
      // Production target. Implement AzureBlobStorageProvider against
      // config.azureBlob and return it here — no other code changes.
      throw new Error(
        'STORAGE_PROVIDER=azure-blob is not wired up yet: add AzureBlobStorageProvider.',
      );
    case 'local':
    default:
      return new LocalStorageProvider(config.storageDir);
  }
}
