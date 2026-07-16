// ============================================================================
// StorageProvider — the single persistence abstraction the whole backend sits
// on. It models storage the way Azure Blob Storage does: named "collections"
// (containers / prefixes) holding either JSON documents or binary blobs.
//
// Repositories depend ONLY on this interface. They never know whether data is
// backed by local files, SQLite, or Azure Blob Storage. Migrating to Azure is
// therefore a matter of adding one class — AzureBlobStorageProvider — that
// implements this interface; no repository, service, handler or API changes.
// ============================================================================

export interface StorageProvider {
  /** Read a JSON document from a collection; `null` if it does not exist. */
  readJson<T>(collection: string, name: string): Promise<T | null>;

  /** Create or overwrite a JSON document in a collection. */
  writeJson<T>(collection: string, name: string, value: T): Promise<void>;

  /** Store a binary blob (e.g. an uploaded .xlsx workbook). */
  putBlob(collection: string, name: string, data: Buffer): Promise<void>;

  /** Read a binary blob; rejects if it is missing. */
  getBlob(collection: string, name: string): Promise<Buffer>;

  /** Delete a binary blob; a no-op if it does not exist. */
  deleteBlob(collection: string, name: string): Promise<void>;

  /** Whether a binary blob exists. */
  blobExists(collection: string, name: string): Promise<boolean>;
}
