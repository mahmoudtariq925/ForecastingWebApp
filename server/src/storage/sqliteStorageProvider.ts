// ============================================================================
// SqliteStorageProvider — an alternative StorageProvider backed by SQLite.
// It proves the abstraction: the same repositories run unchanged on top of it.
// JSON documents live in a `documents` table; binary blobs in a `blobs` table.
// Selected via STORAGE_PROVIDER=sqlite.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { StorageProvider } from './storageProvider.js';

export class SqliteStorageProvider implements StorageProvider {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        name       TEXT NOT NULL,
        json       TEXT NOT NULL,
        PRIMARY KEY (collection, name)
      );
      CREATE TABLE IF NOT EXISTS blobs (
        collection TEXT NOT NULL,
        name       TEXT NOT NULL,
        data       BLOB NOT NULL,
        PRIMARY KEY (collection, name)
      );
    `);
  }

  async readJson<T>(collection: string, name: string): Promise<T | null> {
    const row = this.db
      .prepare('SELECT json FROM documents WHERE collection = ? AND name = ?')
      .get(collection, name) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : null;
  }

  async writeJson<T>(collection: string, name: string, value: T): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO documents (collection, name, json) VALUES (?, ?, ?)
         ON CONFLICT(collection, name) DO UPDATE SET json = excluded.json`,
      )
      .run(collection, name, JSON.stringify(value));
  }

  async putBlob(collection: string, name: string, data: Buffer): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO blobs (collection, name, data) VALUES (?, ?, ?)
         ON CONFLICT(collection, name) DO UPDATE SET data = excluded.data`,
      )
      .run(collection, name, data);
  }

  async getBlob(collection: string, name: string): Promise<Buffer> {
    const row = this.db
      .prepare('SELECT data FROM blobs WHERE collection = ? AND name = ?')
      .get(collection, name) as { data: Buffer } | undefined;
    if (!row) throw new Error(`Blob not found: ${collection}/${name}`);
    return row.data;
  }

  async deleteBlob(collection: string, name: string): Promise<void> {
    this.db.prepare('DELETE FROM blobs WHERE collection = ? AND name = ?').run(collection, name);
  }

  async blobExists(collection: string, name: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM blobs WHERE collection = ? AND name = ?')
      .get(collection, name);
    return Boolean(row);
  }
}
