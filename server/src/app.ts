// ============================================================================
// Composition root. Wires the layered architecture together:
//
//   StorageProvider → Repositories → Services → Handlers → Routes → Adapter
//
// Each arrow is an interface boundary. Swapping the storage backend touches
// only createStorageProvider(); swapping the web host (Express → Azure
// Functions) touches only the adapter + a route-table binding.
// ============================================================================
import { createStorageProvider, createFileStorage } from './storage/index.js';
import { createRepositories } from './repositories/index.js';
import { createServices } from './services/index.js';
import { createHandlers } from './handlers/index.js';
import { createRoutes } from './http/routes.js';
import { createExpressApp } from './http/expressAdapter.js';
import { seedIfEmpty } from './seed.js';
import { config } from './config.js';

export async function createApp() {
  const provider = createStorageProvider();
  const files = createFileStorage(provider);
  const repos = createRepositories(provider);
  await seedIfEmpty(repos, files, config.standardTemplateSource);

  const services = createServices(repos, files);
  const handlers = createHandlers(services);
  const routes = createRoutes(handlers);
  return createExpressApp(routes, config.maxUploadBytes);
}
