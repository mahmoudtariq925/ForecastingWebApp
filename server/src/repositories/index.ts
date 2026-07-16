// Repository factory — the single place that decides which persistence
// backend the app runs on. Azure migration: implement the interfaces in
// ./types.ts against Azure SQL and return them here instead.
import { openDatabase } from '../db/index.js';
import { createSqliteRepositories } from './sqlite.js';
import type { Repositories } from './types.js';

export type { Repositories, TemplateRecord } from './types.js';

export function createRepositories(dbPath: string): Repositories {
  const db = openDatabase(dbPath);
  return createSqliteRepositories(db);
}
