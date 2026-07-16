// Typed API calls per resource. Screens import these instead of touching any
// local data — all business data lives behind the backend.
import type {
  ApprovalMap,
  Cycle,
  Entity,
  ForecastTemplate,
  Settings,
  Submission,
  SubmissionStatus,
  TemplateLayout,
  User,
  Variance,
} from '../types';
import { api, apiBlob, apiOrNull, json } from './client';

// --- reference data ---------------------------------------------------------
export const getEntities = () => api<Entity[]>('/entities');
export const getVariances = () => api<Variance[]>('/variances');

// --- users -------------------------------------------------------------------
export const getUsers = () => api<User[]>('/users');
export const createUser = (user: User) => api<User>('/users', json('POST', user));
export const updateUser = (email: string, patch: Partial<User>) =>
  api<User>(`/users/${encodeURIComponent(email)}`, json('PATCH', patch));
export const deleteUser = (email: string) =>
  api<void>(`/users/${encodeURIComponent(email)}`, { method: 'DELETE' });

// --- cycles ------------------------------------------------------------------
export const getCycles = () => api<Cycle[]>('/cycles');
export const createCycle = (cycle: Cycle) => api<Cycle>('/cycles', json('POST', cycle));
export const updateCycle = (id: string, patch: Partial<Cycle>) =>
  api<Cycle>(`/cycles/${encodeURIComponent(id)}`, json('PATCH', patch));

// --- settings ----------------------------------------------------------------
export const getSettings = () => api<Settings>('/settings');
export const putSettings = (settings: Settings) => api<Settings>('/settings', json('PUT', settings));

// --- templates ---------------------------------------------------------------
export const getTemplates = () => api<ForecastTemplate[]>('/templates');

export function uploadTemplate(
  file: File,
  layout: TemplateLayout | 'auto',
  uploadedBy: string,
): Promise<ForecastTemplate> {
  const form = new FormData();
  form.append('file', file);
  form.append('layout', layout);
  form.append('uploadedBy', uploadedBy);
  return api<ForecastTemplate>('/templates', { method: 'POST', body: form });
}

export const updateTemplate = (
  id: string,
  patch: { name?: string; layout?: TemplateLayout; assignedEntities?: string[] },
) => api<ForecastTemplate>(`/templates/${encodeURIComponent(id)}`, json('PATCH', patch));

export function replaceTemplateFile(id: string, file: File): Promise<ForecastTemplate> {
  const form = new FormData();
  form.append('file', file);
  return api<ForecastTemplate>(`/templates/${encodeURIComponent(id)}/file`, {
    method: 'PUT',
    body: form,
  });
}

export const deleteTemplate = (id: string) =>
  api<void>(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const downloadTemplateFile = (id: string) =>
  apiBlob(`/templates/${encodeURIComponent(id)}/file`);

// --- submissions ---------------------------------------------------------------
const subPath = (period: string, entity: string, templateId: string) =>
  `/submissions/${encodeURIComponent(period)}/${encodeURIComponent(entity)}/${encodeURIComponent(templateId)}`;

export const listSubmissions = (filter?: { period?: string; entity?: string }) => {
  const params = new URLSearchParams();
  if (filter?.period) params.set('period', filter.period);
  if (filter?.entity) params.set('entity', filter.entity);
  const qs = params.toString();
  return api<Submission[]>(`/submissions${qs ? `?${qs}` : ''}`);
};

export const getSubmission = (period: string, entity: string, templateId: string) =>
  apiOrNull<Submission>(subPath(period, entity, templateId));

export const putSubmission = (submission: Submission) =>
  api<Submission>(
    subPath(submission.period, submission.entity, submission.templateId),
    json('PUT', submission),
  );

// --- approvals -----------------------------------------------------------------
export const getApprovals = (cycleId: string) =>
  api<ApprovalMap>(`/approvals/${encodeURIComponent(cycleId)}`);

export const putApproval = (cycleId: string, entity: string, status: SubmissionStatus) =>
  api<ApprovalMap>(
    `/approvals/${encodeURIComponent(cycleId)}/${encodeURIComponent(entity)}`,
    json('PUT', { status }),
  );
