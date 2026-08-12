// ============================================================================
// Forecast cycles.
//
// A cycle IS a forecast week. That sounds obvious, but the two used to be
// unrelated: the cycle list was five hardcoded May dates while every forecast
// on screen was an August week, so the header said "CW-2026-21 · closes May 22"
// above data for week 33, and the cycle list claimed 14/18 submissions against
// a dashboard showing 8/11.
//
// Here the cycle is DERIVED from its week key, and its counts are computed from
// the same stored submissions the dashboard reads. Opening and closing a cycle
// persists a status override, which is the only part a user actually changes.
// Phase 2 replaces the generator with a cycles endpoint; nothing else moves.
// ============================================================================
import type { Cycle, ForecastTemplate, SubmissionStatus } from '../types';
import { DEMO_DATA } from './dataSource';
import { cadenceWeeks, currentWeekKey, isoWeekNumber, isValidWeekKey, shiftWeeks } from './periods';
import { loadData, loadSubmission, saveData } from '../storage/localStorage';

/** How many closed cycles the demo shows behind the open one. */
const DEMO_HISTORY = 4;

type CycleStatus = Cycle['status'];

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "CW-2026-33" — a cycle's identity is its week, so this is never typed. */
export function cycleIdFor(weekKey: string): string {
  const d = fromKey(weekKey);
  return `CW-${d.getFullYear()}-${String(isoWeekNumber(d)).padStart(2, '0')}`;
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/** The cycle that collects `weekKey`, before any stored status override. */
function buildCycle(weekKey: string, status: CycleStatus): Cycle {
  const monday = fromKey(weekKey);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  return {
    id: cycleIdFor(weekKey),
    weekKey,
    start: fmtDay(monday),
    closes: `${fmtDay(friday)} · 18:00`,
    status,
    openedAt: monday.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Status overrides — the only mutable part of a cycle.
// ---------------------------------------------------------------------------
const STATUS_KEY = 'cycleStatus';

function statusOverrides(): Record<string, CycleStatus> {
  const raw = loadData<unknown>(STATUS_KEY, null);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, CycleStatus>)
    : {};
}

/** Open or close a cycle. Closing is what "consolidated" means here. */
export function setCycleStatus(id: string, status: CycleStatus): void {
  saveData(STATUS_KEY, { ...statusOverrides(), [id]: status });
}

// ---------------------------------------------------------------------------
// Extra cycles opened from the New Cycle modal.
// ---------------------------------------------------------------------------
const EXTRA_KEY = 'extraCycleWeeks';

function extraWeeks(): string[] {
  const raw = loadData<unknown>(EXTRA_KEY, null);
  return Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : [];
}

/** Register a week as an explicitly opened cycle (New Cycle modal). */
export function openCycleForWeek(weekKey: string): void {
  if (!isValidWeekKey(weekKey)) return;
  const weeks = extraWeeks();
  if (!weeks.includes(weekKey)) saveData(EXTRA_KEY, [...weeks, weekKey]);
  setCycleStatus(cycleIdFor(weekKey), 'submitted');
}

/**
 * Every cycle the app knows about, newest first.
 *
 * The current week is always present and open by default; the demo shows four
 * closed weeks behind it so the history looks lived-in. Stored status
 * overrides are layered on top, so opening or closing a cycle survives a
 * reload without freezing its dates.
 */
export function listCycles(): Cycle[] {
  const current = currentWeekKey();
  const weeks = new Set<string>([current, ...extraWeeks()]);
  if (DEMO_DATA) {
    // Cycles sit a cadence apart, so the history reflects the Cycle Frequency
    // setting rather than always being consecutive weeks.
    const step = cadenceWeeks();
    for (let i = 1; i <= DEMO_HISTORY; i++) weeks.add(shiftWeeks(current, -i * step));
  }
  const overrides = statusOverrides();
  return [...weeks]
    .sort((a, b) => b.localeCompare(a))
    .map((week) => {
      const fallback: CycleStatus = week >= current ? 'submitted' : 'consolidated';
      const id = cycleIdFor(week);
      return buildCycle(week, overrides[id] ?? fallback);
    });
}

/**
 * The cycle the app is working in: the most recent OPEN one, falling back to
 * the newest cycle so there is always exactly one answer. Every screen asks
 * this rather than picking a cycle for itself.
 */
export function activeCycle(): Cycle {
  const cycles = listCycles();
  return cycles.find((c) => c.status === 'submitted') ?? cycles[0] ?? buildCycle(currentWeekKey(), 'submitted');
}

/** The forecast week the app is working in — the active cycle's week. */
export function activeWeekKey(): string {
  return activeCycle().weekKey;
}

/** The cycle collecting a given week, if the app knows about it. */
export function cycleForWeek(weekKey: string): Cycle | null {
  return listCycles().find((c) => c.weekKey === weekKey) ?? null;
}

// ---------------------------------------------------------------------------
// Counts — computed from the same submissions every other screen reads.
// ---------------------------------------------------------------------------

/** Has a forecast reached the approver (or beyond)? Rejected has not. */
export function isReceived(status: SubmissionStatus): boolean {
  return status === 'submitted' || status === 'approved' || status === 'consolidated';
}

export interface CycleSummary {
  received: number;
  expected: number;
  approved: number;
  /** Consolidated total of received forecasts, EUR millions. */
  totalM: number;
  /** Countries that have not submitted, or have submitted but not approved. */
  outstanding: { entity: string; status: SubmissionStatus }[];
}

/**
 * What a cycle actually contains. Callers pass the entities and their
 * templates so this stays free of the entity/permission layer.
 */
export function cycleSummary(
  cycle: Cycle,
  entities: { name: string }[],
  templateFor: (entity: string) => ForecastTemplate | null,
  statusFor: (entity: string, week: string, templateId: string) => SubmissionStatus,
): CycleSummary {
  let received = 0;
  let approved = 0;
  let totalK = 0;
  const outstanding: { entity: string; status: SubmissionStatus }[] = [];

  for (const e of entities) {
    const template = templateFor(e.name);
    const status = statusFor(e.name, cycle.weekKey, template?.id ?? '');
    if (isReceived(status)) {
      received += 1;
      const sub = template ? loadSubmission(cycle.weekKey, e.name, template.id) : null;
      if (sub) {
        totalK += Object.values(sub.values ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
      }
    }
    if (status === 'approved' || status === 'consolidated') approved += 1;
    else outstanding.push({ entity: e.name, status });
  }

  return {
    received,
    expected: entities.length,
    approved,
    totalM: Math.round(totalK / 100) / 10,
    outstanding,
  };
}

// ---------------------------------------------------------------------------
// Chasers.
//
// "Send Chaser" opened a mail draft and left no trace, so on Friday afternoon
// treasury had no way to tell who they had already nudged — the row looked
// identical before and after. Recording the send makes the list answer
// "who still needs chasing?" rather than just "who has not submitted?".
// ---------------------------------------------------------------------------
const chaserKey = (cycleId: string) => `chasers:${cycleId}`;

/** Entity → ISO timestamp of the last chaser sent for a cycle. */
export function loadChasers(cycleId: string): Record<string, string> {
  const raw = loadData<unknown>(chaserKey(cycleId), null);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, string>)
    : {};
}

/** Record that a chaser has just been sent to an entity for this cycle. */
export function markChaserSent(cycleId: string, entity: string): void {
  saveData(chaserKey(cycleId), { ...loadChasers(cycleId), [entity]: new Date().toISOString() });
}

/** "just now" / "3h ago" / "2d ago" for a chaser timestamp. */
export function chasedLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'chased';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'chased just now';
  if (mins < 60) return `chased ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `chased ${hours}h ago`;
  return `chased ${Math.floor(hours / 24)}d ago`;
}
