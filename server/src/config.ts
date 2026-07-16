import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Which storage provider backs persistence. */
export type StorageProviderKind = 'local' | 'sqlite' | 'azure-blob';

/**
 * Runtime configuration. Everything is overridable via environment variables
 * so the Azure deployment (Functions + Blob Storage) only needs env changes,
 * not code changes.
 */
export const config = {
  port: Number(process.env.PORT ?? 4000),

  /**
   * Persistence backend. `local` (default) mirrors Azure Blob Storage using a
   * folder of JSON documents + uploaded files; `sqlite` is an alternative
   * implementation of the same StorageProvider interface; `azure-blob` is the
   * production target (implement AzureBlobStorageProvider to enable it).
   */
  storageProvider: (process.env.STORAGE_PROVIDER ?? 'local') as StorageProviderKind,

  /** Root folder for the LocalStorageProvider (→ a Blob container in prod). */
  storageDir: process.env.STORAGE_DIR ?? path.join(serverRoot, 'storage'),

  /** File backing the SqliteStorageProvider, when selected. */
  sqlitePath: process.env.SQLITE_PATH ?? path.join(serverRoot, 'data', 'liquid.db'),

  /** Azure Blob settings, read by a future AzureBlobStorageProvider. */
  azureBlob: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING ?? '',
    container: process.env.AZURE_STORAGE_CONTAINER ?? 'liquid',
  },

  /** Where the seed reads the built-in standard template workbook from. */
  standardTemplateSource:
    process.env.STANDARD_TEMPLATE_SOURCE ??
    path.join(serverRoot, '..', 'samples', 'CF_Forecast_Template.xlsx'),

  maxUploadBytes: 5 * 1024 * 1024,
};
