import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Runtime configuration. Everything is overridable via environment variables
 * so the Azure deployment (App Service / Container Apps) only needs env
 * changes, not code changes.
 */
export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** SQLite database file (→ Azure SQL connection string in production). */
  dbPath: process.env.DB_PATH ?? path.join(serverRoot, 'data', 'liquid.db'),
  /** Local uploads directory (→ Azure Blob container in production). */
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(serverRoot, 'uploads'),
  /** Where the seed copies the built-in standard template workbook from. */
  standardTemplateSource:
    process.env.STANDARD_TEMPLATE_SOURCE ??
    path.join(serverRoot, '..', 'samples', 'CF_Forecast_Template.xlsx'),
  maxUploadBytes: 5 * 1024 * 1024,
};
