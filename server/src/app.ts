import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { createRepositories } from './repositories/index.js';
import { createFileStorage } from './storage/fileStorage.js';
import { seedIfEmpty } from './db/seed.js';
import { TemplatesService } from './services/templatesService.js';
import {
  ApprovalsService,
  CyclesService,
  EntitiesService,
  SettingsService,
  SubmissionsService,
  UsersService,
  VariancesService,
} from './services/coreServices.js';
import { templatesController } from './controllers/templatesController.js';
import {
  approvalsController,
  cyclesController,
  entitiesController,
  settingsController,
  submissionsController,
  usersController,
  variancesController,
} from './controllers/coreControllers.js';
import { HttpError } from './services/errors.js';
import { config } from './config.js';

/** Build the Express app: repositories → services → controllers. */
export async function createApp() {
  const repos = createRepositories(config.dbPath);
  const files = createFileStorage(config.uploadsDir);
  await seedIfEmpty(repos, files, config.standardTemplateSource);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/entities', entitiesController(new EntitiesService(repos)));
  app.use('/api/users', usersController(new UsersService(repos)));
  app.use('/api/cycles', cyclesController(new CyclesService(repos)));
  app.use('/api/settings', settingsController(new SettingsService(repos)));
  app.use('/api/templates', templatesController(new TemplatesService(repos, files), config.maxUploadBytes));
  app.use('/api/submissions', submissionsController(new SubmissionsService(repos)));
  app.use('/api/approvals', approvalsController(new ApprovalsService(repos)));
  app.use('/api/variances', variancesController(new VariancesService(repos)));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler: HttpError → its status, everything else → 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  });

  return app;
}
