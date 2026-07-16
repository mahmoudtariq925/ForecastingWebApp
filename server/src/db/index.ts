import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Open (creating if needed) the SQLite database and ensure the schema. */
export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      name      TEXT PRIMARY KEY,
      submitter TEXT NOT NULL,
      approver  TEXT NOT NULL,
      total     REAL NOT NULL,
      delta     REAL NOT NULL,
      status    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      team  TEXT NOT NULL,
      role  TEXT NOT NULL,
      scope TEXT NOT NULL,
      last  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cycles (
      id     TEXT PRIMARY KEY,
      start  TEXT NOT NULL,
      closes TEXT NOT NULL,
      status TEXT NOT NULL,
      subs   TEXT NOT NULL,
      total  REAL NOT NULL,
      sort   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      file_name   TEXT,
      file_key    TEXT,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      layout      TEXT NOT NULL,
      categories  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS template_assignments (
      template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      entity      TEXT NOT NULL,
      PRIMARY KEY (template_id, entity)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      period            TEXT NOT NULL,
      entity            TEXT NOT NULL,
      template_id       TEXT NOT NULL,
      status            TEXT NOT NULL,
      values_json       TEXT NOT NULL,
      flags_json        TEXT NOT NULL,
      comments_json     TEXT NOT NULL,
      day_comments_json TEXT NOT NULL,
      starting_balance  REAL NOT NULL,
      updated_at        TEXT NOT NULL,
      PRIMARY KEY (period, entity, template_id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      cycle_id TEXT NOT NULL,
      entity   TEXT NOT NULL,
      status   TEXT NOT NULL,
      PRIMARY KEY (cycle_id, entity)
    );

    CREATE TABLE IF NOT EXISTS variances (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ent     TEXT NOT NULL,
      cat     TEXT NOT NULL,
      day     TEXT NOT NULL,
      prior   REAL NOT NULL,
      current REAL NOT NULL,
      comment TEXT NOT NULL
    );
  `);

  return db;
}
