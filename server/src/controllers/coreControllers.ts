// HTTP routing for the simpler resources — controllers translate requests to
// service calls and results to JSON; no business logic lives here.
import { Router } from 'express';
import type {
  ApprovalsService,
  CyclesService,
  EntitiesService,
  SettingsService,
  SubmissionsService,
  UsersService,
  VariancesService,
} from '../services/coreServices.js';

export function entitiesController(service: EntitiesService): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json(service.list()));
  return router;
}

export function usersController(service: UsersService): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json(service.list()));
  router.post('/', (req, res) => res.status(201).json(service.create(req.body)));
  router.patch('/:email', (req, res) => res.json(service.update(req.params.email, req.body)));
  router.delete('/:email', (req, res) => {
    service.remove(req.params.email);
    res.status(204).end();
  });
  return router;
}

export function cyclesController(service: CyclesService): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json(service.list()));
  router.post('/', (req, res) => res.status(201).json(service.create(req.body)));
  router.patch('/:id', (req, res) => res.json(service.update(req.params.id, req.body)));
  return router;
}

export function settingsController(service: SettingsService): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json(service.get()));
  router.put('/', (req, res) => res.json(service.put(req.body)));
  return router;
}

export function submissionsController(service: SubmissionsService): Router {
  const router = Router();
  router.get('/', (req, res) =>
    res.json(
      service.list({
        period: (req.query.period as string) || undefined,
        entity: (req.query.entity as string) || undefined,
      }),
    ),
  );
  router.get('/:period/:entity/:templateId', (req, res) =>
    res.json(service.get(req.params.period, req.params.entity, req.params.templateId)),
  );
  router.put('/:period/:entity/:templateId', (req, res) =>
    res.json(
      service.upsert({
        ...req.body,
        period: req.params.period,
        entity: req.params.entity,
        templateId: req.params.templateId,
      }),
    ),
  );
  return router;
}

export function approvalsController(service: ApprovalsService): Router {
  const router = Router();
  router.get('/:cycleId', (req, res) => res.json(service.getForCycle(req.params.cycleId)));
  router.put('/:cycleId/:entity', (req, res) =>
    res.json(service.decide(req.params.cycleId, req.params.entity, req.body.status)),
  );
  return router;
}

export function variancesController(service: VariancesService): Router {
  const router = Router();
  router.get('/', (_req, res) => res.json(service.list()));
  return router;
}
