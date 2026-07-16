// ============================================================================
// Azure Function-style request handlers. Each handler is an isolated
// (HttpRequest) => Promise<HttpResult> function with minimal HTTP logic: read
// params/query/body/file, call a service, shape the result. No business rules
// and no framework types live here, so each handler could be dropped into an
// Azure Function with only a host adapter around it.
// ============================================================================
import type { Cycle, Submission, User } from '../../../shared/types';
import type { Services } from '../services/index.js';
import { badRequest } from '../services/errors.js';
import {
  created,
  fileDownload,
  noContent,
  ok,
  XLSX_MIME,
  type Handler,
} from '../http/http.js';

export interface Handlers {
  health: Handler;
  entities: { list: Handler };
  variances: { list: Handler };
  users: { list: Handler; create: Handler; update: Handler; remove: Handler };
  cycles: { list: Handler; create: Handler; update: Handler };
  settings: { get: Handler; put: Handler };
  submissions: { list: Handler; get: Handler; put: Handler };
  approvals: { getForCycle: Handler; decide: Handler };
  templates: {
    list: Handler;
    get: Handler;
    create: Handler;
    update: Handler;
    replaceFile: Handler;
    getFile: Handler;
    remove: Handler;
  };
}

export function createHandlers(services: Services): Handlers {
  return {
    health: async () => ok({ ok: true }),

    entities: {
      list: async () => ok(await services.entities.list()),
    },

    variances: {
      list: async () => ok(await services.variances.list()),
    },

    users: {
      list: async () => ok(await services.users.list()),
      create: async (req) => created(await services.users.create(req.body as User)),
      update: async (req) =>
        ok(await services.users.update(req.params.email, req.body as Partial<User>)),
      remove: async (req) => {
        await services.users.remove(req.params.email);
        return noContent();
      },
    },

    cycles: {
      list: async () => ok(await services.cycles.list()),
      create: async (req) => created(await services.cycles.create(req.body as Cycle)),
      update: async (req) =>
        ok(await services.cycles.update(req.params.id, req.body as Partial<Cycle>)),
    },

    settings: {
      get: async () => ok(await services.settings.get()),
      put: async (req) => ok(await services.settings.put(req.body as never)),
    },

    submissions: {
      list: async (req) =>
        ok(
          await services.submissions.list({
            period: req.query.period || undefined,
            entity: req.query.entity || undefined,
          }),
        ),
      get: async (req) =>
        ok(
          await services.submissions.get(
            req.params.period,
            req.params.entity,
            req.params.templateId,
          ),
        ),
      put: async (req) =>
        ok(
          await services.submissions.upsert({
            ...(req.body as Submission),
            period: req.params.period,
            entity: req.params.entity,
            templateId: req.params.templateId,
          }),
        ),
    },

    approvals: {
      getForCycle: async (req) => ok(await services.approvals.getForCycle(req.params.cycleId)),
      decide: async (req) =>
        ok(
          await services.approvals.decide(
            req.params.cycleId,
            req.params.entity,
            (req.body as { status: Submission['status'] }).status,
          ),
        ),
    },

    templates: {
      list: async () => ok(await services.templates.list()),
      get: async (req) => ok(await services.templates.get(req.params.id)),
      create: async (req) => {
        if (!req.file) throw badRequest('An .xlsx file is required (multipart field "file")');
        const body = (req.body ?? {}) as { layout?: string; uploadedBy?: string };
        const template = await services.templates.upload(
          req.file,
          (body.layout as 'auto' | 'grouped' | 'days-across') || 'auto',
          body.uploadedBy || 'Unknown',
        );
        return created(template);
      },
      update: async (req) =>
        ok(await services.templates.update(req.params.id, req.body as never)),
      replaceFile: async (req) => {
        if (!req.file) throw badRequest('An .xlsx file is required (multipart field "file")');
        return ok(await services.templates.replaceFile(req.params.id, req.file));
      },
      getFile: async (req) => {
        const { fileName, data } = await services.templates.getFile(req.params.id);
        return fileDownload({ fileName, contentType: XLSX_MIME, data });
      },
      remove: async (req) => {
        await services.templates.remove(req.params.id);
        return noContent();
      },
    },
  };
}
