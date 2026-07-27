// ============================================================================
// Persistence layer (Phase 1: browser localStorage).
//
// Every read and write in the app funnels through this file. To move to a real
// backend in Phase 2 (Azure Functions + Blob Storage), reimplement these
// functions against the API — no screen component imports localStorage
// directly, so this is intended to be a one-file change.
//
// The generic saveData/loadData underpin the named, typed helpers below.
// ============================================================================
import type {
  Cycle,
  ForecastTemplate,
  LegalEntity,
  Settings,
  Submission,
  User,
} from '../types';
import { buildStandardTemplate } from '../data/mockData';

const PREFIX = 'liquid:';

/** Low-level: persist any JSON-serialisable value under a namespaced key. */
export function saveData<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (err) {
    // Storage can throw in private mode or when the quota is exceeded.
    console.warn(`[storage] failed to save "${key}"`, err);
  }
}

/** Low-level: load a value, returning `fallback` when absent or unparsable. */
export function loadData<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[storage] failed to load "${key}"`, err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Shape guards. localStorage can hold anything an older app version (or a
// stray write) left behind; every typed read below validates the top-level
// shape and falls back to the seed data instead of letting a malformed value
// crash the whole app at render time.
// ---------------------------------------------------------------------------

/** A parsed value that should be a plain object (not null / array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keep only object entries of a stored array (drops null/junk elements). */
function objectEntries<T>(v: unknown): T[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((item): item is T => isRecord(item as unknown));
}

/** Low-level: remove a value. */
export function removeData(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (err) {
    console.warn(`[storage] failed to remove "${key}"`, err);
  }
}

// ---------------------------------------------------------------------------
// Submissions — one grid submission per reporting period + entity + template.
// Historical periods stay stored under their own keys, so editing one period
// never affects another.
// ---------------------------------------------------------------------------
const SUBMISSION_PREFIX = 'submission:';
const submissionKey = (period: string, entity: string, templateId: string) =>
  `${SUBMISSION_PREFIX}${period}:${entity}:${templateId}`;

export function saveSubmission(submission: Submission): void {
  saveData(submissionKey(submission.period, submission.entity, submission.templateId), submission);
}

export function loadSubmission(
  period: string,
  entity: string,
  templateId: string,
): Submission | null {
  const raw = loadData<unknown>(submissionKey(period, entity, templateId), null);
  return isRecord(raw) ? (raw as unknown as Submission) : null;
}

export function removeSubmission(period: string, entity: string, templateId: string): void {
  removeData(submissionKey(period, entity, templateId));
}

/** All stored submissions, optionally filtered to one period. One malformed
 * entry is skipped rather than aborting the whole listing. */
export function listSubmissions(period?: string): Submission[] {
  const out: Submission[] = [];
  let keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX + SUBMISSION_PREFIX)) keys.push(key);
    }
  } catch (err) {
    console.warn('[storage] failed to enumerate submissions', err);
    keys = [];
  }
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const sub = JSON.parse(raw) as Submission;
      if (!isRecord(sub)) continue;
      // Periods must be ISO week keys ("YYYY-MM-DD"); entries written by very
      // old app versions used other formats and are unusable in the current
      // rolling-weekly model, so they are ignored rather than crashing screens.
      if (typeof sub.period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sub.period)) continue;
      if (typeof sub.entity !== 'string' || typeof sub.templateId !== 'string') continue;
      if (period && sub.period !== period) continue;
      out.push(sub);
    } catch (err) {
      console.warn(`[storage] skipped malformed submission entry "${key}"`, err);
    }
  }
  return out;
}

/** Periods that have at least one stored submission for the given entity. */
export function periodsWithSubmissions(entity: string): Set<string> {
  return new Set(
    listSubmissions()
      .filter((s) => s.entity === entity)
      .map((s) => s.period),
  );
}

// ---------------------------------------------------------------------------
// Forecast templates — uploaded .xlsx structures + entity assignments.
// Seeded with the standard template on first load.
// ---------------------------------------------------------------------------

/** Shape of templates stored before the category/layout model. */
interface LegacyTemplate {
  id: string;
  name: string;
  fileName?: string;
  uploadedAt: string;
  uploadedBy: string;
  assignedEntities: string[];
  rows?: { label?: string; kind?: string; section?: string }[];
  fileData?: string;
}

/** Convert a pre-layout template (row kinds) into the category model. */
function migrateTemplate(legacy: LegacyTemplate): ForecastTemplate {
  const categories: ForecastTemplate['categories'] = [];
  let group: string | undefined;
  for (const row of legacy.rows ?? []) {
    if (row.kind === 'section') group = row.label ?? row.section;
    else if (row.kind === 'data' && row.label) categories.push({ label: row.label, group });
  }
  return {
    id: legacy.id,
    name: legacy.name,
    fileName: legacy.fileName,
    uploadedAt: legacy.uploadedAt,
    uploadedBy: legacy.uploadedBy,
    assignedEntities: legacy.assignedEntities ?? [],
    layout: 'days-across',
    categories,
    fileData: legacy.fileData,
  };
}

export function loadTemplates(): ForecastTemplate[] {
  const raw = loadData<unknown>('templates', null);
  // Drop junk elements (e.g. null) before inspecting shapes — `'layout' in t`
  // on a non-object would otherwise crash every screen that loads templates.
  const stored = objectEntries<ForecastTemplate | LegacyTemplate>(raw);
  if (!stored || stored.length === 0) {
    const seeded = [buildStandardTemplate()];
    saveData('templates', seeded);
    return seeded;
  }
  // Migrate any templates saved before the layout/category model existed;
  // the old built-in template is replaced by the new standard workbook one.
  if (stored.some((t) => !('layout' in t))) {
    const migrated: ForecastTemplate[] = [buildStandardTemplate()];
    for (const t of stored) {
      if ('layout' in t) migrated.push(t);
      else if (t.id !== 'tpl-standard') migrated.push(migrateTemplate(t));
    }
    saveData('templates', migrated);
    return migrated;
  }
  return stored as ForecastTemplate[];
}

export function saveTemplates(templates: ForecastTemplate[]): void {
  saveData('templates', templates);
}

// ---------------------------------------------------------------------------
// Cycles — status is the main thing that changes at runtime (open/close).
// ---------------------------------------------------------------------------
export function saveCycles(cycles: Cycle[]): void {
  saveData('cycles', cycles);
}

export function loadCycles(fallback: Cycle[]): Cycle[] {
  return objectEntries<Cycle>(loadData<unknown>('cycles', null)) ?? fallback;
}

export function saveCycle(cycle: Cycle, all: Cycle[]): Cycle[] {
  const next = all.map((c) => (c.id === cycle.id ? cycle : c));
  if (!next.some((c) => c.id === cycle.id)) next.unshift(cycle);
  saveCycles(next);
  return next;
}

// ---------------------------------------------------------------------------
// Approval statuses — keyed by cycle + entity.
// ---------------------------------------------------------------------------
export type ApprovalMap = Record<string, Submission['status']>;
const approvalKey = (cycleId: string) => `approvals:${cycleId}`;

export function saveApprovals(cycleId: string, map: ApprovalMap): void {
  saveData(approvalKey(cycleId), map);
}

export function loadApprovals(cycleId: string): ApprovalMap {
  const raw = loadData<unknown>(approvalKey(cycleId), null);
  return isRecord(raw) ? (raw as ApprovalMap) : {};
}

// ---------------------------------------------------------------------------
// Users / role assignments.
// ---------------------------------------------------------------------------
export function saveUsers(users: User[]): void {
  saveData('users', users);
}

export function loadUsers(fallback: User[]): User[] {
  const users = objectEntries<User>(loadData<unknown>('users', null));
  if (!users || users.length === 0) return fallback;
  // Users stored before the status field existed default to active.
  return users.map((u) => ({ ...u, status: u.status === 'inactive' ? 'inactive' : 'active' }));
}

// ---------------------------------------------------------------------------
// Legal entities — entity master data plus the users responsible for each
// entity and its forecast template (configured in Legal Entity Setup).
// ---------------------------------------------------------------------------
export function saveLegalEntities(legalEntities: LegalEntity[]): void {
  saveData('legalEntities', legalEntities);
}

export function loadLegalEntities(fallback: LegalEntity[]): LegalEntity[] {
  const stored = objectEntries<LegalEntity>(loadData<unknown>('legalEntities', null));
  if (!stored || stored.length === 0) return fallback;
  // Guard the assignment lists: older/partial records must not break callers.
  const emails = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : [];
  return stored.map((e) => ({
    ...e,
    viewers: emails(e.viewers),
    approvers: emails(e.approvers),
    submitters: emails(e.submitters),
    status: e.status === 'inactive' ? 'inactive' : 'active',
  }));
}

// ---------------------------------------------------------------------------
// Settings — variance thresholds and cycle rules.
// ---------------------------------------------------------------------------
export function saveSettings(settings: Settings): void {
  saveData('settings', settings);
}

export function loadSettings(fallback: Settings): Settings {
  const raw = loadData<unknown>('settings', null);
  // Merge over the defaults so fields added in newer versions are present.
  return isRecord(raw) ? { ...fallback, ...(raw as Partial<Settings>) } : fallback;
}
