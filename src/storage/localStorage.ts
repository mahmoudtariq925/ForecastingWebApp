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
import type { Cycle, ForecastTemplate, Settings, Submission, User } from '../types';
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
  return loadData<Submission | null>(submissionKey(period, entity, templateId), null);
}

export function removeSubmission(period: string, entity: string, templateId: string): void {
  removeData(submissionKey(period, entity, templateId));
}

/** All stored submissions, optionally filtered to one period. */
export function listSubmissions(period?: string): Submission[] {
  const out: Submission[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX + SUBMISSION_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const sub = JSON.parse(raw) as Submission;
      if (!sub || typeof sub !== 'object' || !sub.period) continue;
      if (period && sub.period !== period) continue;
      out.push(sub);
    }
  } catch (err) {
    console.warn('[storage] failed to list submissions', err);
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
export function loadTemplates(): ForecastTemplate[] {
  const stored = loadData<ForecastTemplate[] | null>('templates', null);
  if (stored) return stored;
  const seeded = [buildStandardTemplate()];
  saveData('templates', seeded);
  return seeded;
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
  return loadData('cycles', fallback);
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
  return loadData<ApprovalMap>(approvalKey(cycleId), {});
}

// ---------------------------------------------------------------------------
// Users / role assignments.
// ---------------------------------------------------------------------------
export function saveUsers(users: User[]): void {
  saveData('users', users);
}

export function loadUsers(fallback: User[]): User[] {
  return loadData('users', fallback);
}

// ---------------------------------------------------------------------------
// Settings — variance thresholds and cycle rules.
// ---------------------------------------------------------------------------
export function saveSettings(settings: Settings): void {
  saveData('settings', settings);
}

export function loadSettings(fallback: Settings): Settings {
  return loadData('settings', fallback);
}
