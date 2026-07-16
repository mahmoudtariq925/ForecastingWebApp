// Repository factory. Repositories are storage-agnostic: they run over any
// StorageProvider, so this never needs to change when the backend does.
import type { StorageProvider } from '../storage/storageProvider.js';
import { createJsonRepositories } from './jsonRepositories.js';
import type { Repositories } from './types.js';

export type { Repositories, TemplateRecord } from './types.js';

export function createRepositories(provider: StorageProvider): Repositories {
  return createJsonRepositories(provider);
}
