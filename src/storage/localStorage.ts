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
import type { Cycle, Settings, Submission, User } from '../types';

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
// Submissions — one grid submission per cycle + entity.
// ---------------------------------------------------------------------------
const submissionKey = (cycleId: string, entity: string) => `submission:${cycleId}:${entity}`;

export function saveSubmission(submission: Submission): void {
  saveData(submissionKey(submission.cycleId, submission.entity), submission);
}

export function loadSubmission(cycleId: string, entity: string): Submission | null {
  return loadData<Submission | null>(submissionKey(cycleId, entity), null);
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
