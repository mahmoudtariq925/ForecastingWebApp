// ============================================================================
// The route table: a framework-neutral list mapping method + path → handler.
// The Express adapter consumes it today; an Azure Functions host would consume
// the same table (mapping each entry to a function). Paths use `:param`
// segments — the only Express-flavored detail, trivially reformatted per host.
// ============================================================================
import type { Handler, HttpMethod } from './http.js';
import type { Handlers } from '../handlers/index.js';

export interface RouteDef {
  method: HttpMethod;
  path: string;
  handler: Handler;
  /** Route accepts a multipart upload (field name "file"). */
  upload?: boolean;
}

export function createRoutes(h: Handlers): RouteDef[] {
  return [
    { method: 'GET', path: '/api/health', handler: h.health },

    { method: 'GET', path: '/api/entities', handler: h.entities.list },
    { method: 'GET', path: '/api/variances', handler: h.variances.list },

    { method: 'GET', path: '/api/users', handler: h.users.list },
    { method: 'POST', path: '/api/users', handler: h.users.create },
    { method: 'PATCH', path: '/api/users/:email', handler: h.users.update },
    { method: 'DELETE', path: '/api/users/:email', handler: h.users.remove },

    { method: 'GET', path: '/api/cycles', handler: h.cycles.list },
    { method: 'POST', path: '/api/cycles', handler: h.cycles.create },
    { method: 'PATCH', path: '/api/cycles/:id', handler: h.cycles.update },

    { method: 'GET', path: '/api/settings', handler: h.settings.get },
    { method: 'PUT', path: '/api/settings', handler: h.settings.put },

    { method: 'GET', path: '/api/submissions', handler: h.submissions.list },
    {
      method: 'GET',
      path: '/api/submissions/:period/:entity/:templateId',
      handler: h.submissions.get,
    },
    {
      method: 'PUT',
      path: '/api/submissions/:period/:entity/:templateId',
      handler: h.submissions.put,
    },

    { method: 'GET', path: '/api/approvals/:cycleId', handler: h.approvals.getForCycle },
    { method: 'PUT', path: '/api/approvals/:cycleId/:entity', handler: h.approvals.decide },

    { method: 'GET', path: '/api/templates', handler: h.templates.list },
    { method: 'POST', path: '/api/templates', handler: h.templates.create, upload: true },
    { method: 'GET', path: '/api/templates/:id', handler: h.templates.get },
    { method: 'PATCH', path: '/api/templates/:id', handler: h.templates.update },
    { method: 'PUT', path: '/api/templates/:id/file', handler: h.templates.replaceFile, upload: true },
    { method: 'GET', path: '/api/templates/:id/file', handler: h.templates.getFile },
    { method: 'DELETE', path: '/api/templates/:id', handler: h.templates.remove },
  ];
}
