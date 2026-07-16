// Service container — constructs every service from the repositories and file
// storage. Handlers receive this bundle; the composition root (app.ts) builds
// it once. Assembling services here keeps wiring out of the handlers.
import type { Repositories } from '../repositories/index.js';
import type { FileStorage } from '../storage/fileStorage.js';
import {
  ApprovalsService,
  CyclesService,
  EntitiesService,
  SettingsService,
  SubmissionsService,
  UsersService,
  VariancesService,
} from './coreServices.js';
import { TemplatesService } from './templatesService.js';

export interface Services {
  entities: EntitiesService;
  users: UsersService;
  cycles: CyclesService;
  settings: SettingsService;
  templates: TemplatesService;
  submissions: SubmissionsService;
  approvals: ApprovalsService;
  variances: VariancesService;
}

export function createServices(repos: Repositories, files: FileStorage): Services {
  return {
    entities: new EntitiesService(repos),
    users: new UsersService(repos),
    cycles: new CyclesService(repos),
    settings: new SettingsService(repos),
    templates: new TemplatesService(repos, files),
    submissions: new SubmissionsService(repos),
    approvals: new ApprovalsService(repos),
    variances: new VariancesService(repos),
  };
}
