// ============================================================================
// Submission lifecycle helpers shared by the Submission screen, the Dashboard
// KPIs, the Consolidated view and the Comparison/Review screens. Sits on top
// of the storage layer; knows how to seed demo data for the standard template
// and how rolling weekly horizons align for variance comparison.
//
// Every screen that shows forecast numbers goes through these helpers, so an
// edit on the Submission screen is reflected everywhere else.
// ============================================================================
import type {
  CommentRequest,
  Entity,
  ForecastQuestion,
  ForecastTemplate,
  IntercompanyLeg,
  IntercompanyMismatch,
  RequesterRole,
  Settings,
  Submission,
  SubmissionStatus,
  ThreadMessage,
  ThreadRole,
  User,
} from '../types';
import {
  generateGridValues,
  STANDARD_TEMPLATE_ID,
  startingBalanceFor,
} from './mockData';
import { listEntities, seedUsers } from './appData';
import { activeCycle } from './cycleService';
import { DEMO_DATA } from './dataSource';
import { listLegalEntities } from './legalEntityService';
import {
  currentWeekKey,
  periodsOf,
  prevWeekKey,
  rollShift,
} from './periods';
import {
  listSubmissions,
  loadApprovals,
  loadData,
  loadSettings,
  loadSubmission,
  loadTemplates,
  loadUsers,
  saveApprovals,
  saveData,
  saveSubmission,
  type ApprovalMap,
} from '../storage/localStorage';
import type { GridValues } from '../components/submissions/gridMath';
import { DEFAULT_SETTINGS } from '../components/settings/defaults';

/**
 * Week-over-week change as a percentage — or null when a percentage would
 * mislead rather than inform.
 *
 * Every variance surface in the app used `(cur - prev) / Math.abs(prev)` with
 * no guard, which produced "+182,600%" from a prior of €1k and "+626%" from a
 * prior of −220 (a move across zero, which has no percentage at all). Those
 * were then sorted and shown as the headline "largest move". Callers render
 * null as "—" and lead with the absolute move instead, which is always honest.
 */
export function pctChange(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  // No base to be a percentage of.
  if (prior === 0) return null;
  // A move that crosses zero cannot be expressed as a percentage of where it
  // started — "up 626%" reads as growth when the line in fact changed sign.
  if (prior < 0 !== current < 0 && current !== 0) return null;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  // Past an order of magnitude the number stops carrying information: the
  // prior was rounding error and the absolute move is what matters.
  return Math.abs(pct) > 999 ? null : pct;
}

const isRequesterRole = (v: unknown): v is RequesterRole =>
  v === 'treasury' || v === 'approver';

const isThreadRole = (v: unknown): v is ThreadRole =>
  v === 'treasury' || v === 'approver' || v === 'submitter';

/** The user directory, for resolving who wrote a message by their name. */
function userByName(name: string): User | undefined {
  return loadUsers(seedUsers()).find(
    (u) => u.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

/**
 * What capacity somebody wrote in — decided by WHO THEY ARE, not by whatever a
 * stored message claims.
 *
 * A stored role can be missing (questions predate the field) or plain wrong:
 * every question an older version recorded was stamped "treasury", so an
 * approver's own question about their country's forecast came back to the
 * submitter attributed to Treasury. Reading the role off the user directory
 * fixes both, and keeps the label honest if somebody's role later changes.
 * The stored value is used only for a name the directory does not know.
 */
function roleOfAuthor(name: string, stored: unknown): ThreadRole {
  const role = userByName(name)?.role;
  if (role === 'approver') return 'approver';
  if (role === 'treasury') return 'treasury';
  if (role === 'submitter') return 'submitter';
  return isThreadRole(stored) ? stored : 'treasury';
}

/** The same, for the side of the conversation that ASKS. */
function roleOfAsker(name: string, stored: unknown): RequesterRole {
  const role = roleOfAuthor(name, stored);
  // A submitter never opens a question; if the directory says one did, the
  // stored role is the better answer.
  if (role === 'submitter') return isRequesterRole(stored) ? stored : 'treasury';
  return role;
}

/** Keep only well-formed thread replies — storage can hold anything. */
function normalizeReplies(raw: unknown): ThreadMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Partial<ThreadMessage> => typeof v === 'object' && v !== null)
    .filter((m) => typeof m.text === 'string' && m.text.trim())
    .map((m) => {
      const from = typeof m.from === 'string' && m.from.trim() ? m.from : 'Unknown';
      return {
        from,
        role: roleOfAuthor(from, m.role),
        text: String(m.text),
        at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Keep only well-formed comment requests — storage can hold anything. */
function normalizeRequests(raw: unknown): Record<string, CommentRequest> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, CommentRequest> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const r = value as Partial<CommentRequest>;
    if (typeof r.message !== 'string' || !r.message.trim()) continue;
    const from = typeof r.from === 'string' ? r.from : 'Treasury';
    out[key] = {
      from,
      fromRole: roleOfAsker(from, r.fromRole),
      message: r.message,
      requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : new Date().toISOString(),
      replies: normalizeReplies(r.replies),
      ...(typeof r.answeredAt === 'string' ? { answeredAt: r.answeredAt } : {}),
    };
  }
  return out;
}

/**
 * The whole conversation about a cell, oldest first: the opening question and
 * every reply.
 *
 * `answer` covers threads written before replies existed — a single answer
 * stored as the cell's commentary, with only `answeredAt` to say it was one.
 * Rendering it as the closing message keeps those conversations readable
 * instead of showing a question nobody appears to have replied to.
 */
export function threadOf(
  request: CommentRequest,
  /** The cell's commentary, which is where a legacy single answer lives. */
  answer: string,
  /** Display name of whoever answers for the entity. */
  submitter: string,
): ThreadMessage[] {
  const opening: ThreadMessage = {
    from: request.from,
    role: request.fromRole ?? 'treasury',
    text: request.message,
    at: request.requestedAt,
  };
  const replies = request.replies ?? [];
  if (replies.length > 0) return [opening, ...replies];
  // Legacy: one answer, kept as the cell's commentary.
  if (request.answeredAt && answer.trim()) {
    return [
      opening,
      { from: submitter, role: 'submitter', text: answer.trim(), at: request.answeredAt },
    ];
  }
  return [opening];
}

/**
 * The thread after `message` is added, as a new requests map.
 *
 * Who wrote it decides where the ball goes: a submitter's reply ANSWERS the
 * question, an asker's follow-up puts it back to awaiting. Pure, so the
 * forecast screen (which persists the whole submission itself) and the
 * questions board can share one definition of what replying means.
 */
export function withThreadMessage(
  requests: Record<string, CommentRequest> | undefined,
  key: string,
  message: ThreadMessage,
): Record<string, CommentRequest> {
  const next = { ...(requests ?? {}) };
  const request = next[key];
  if (!request) return next;
  const replies = [...(request.replies ?? []), message];
  next[key] =
    message.role === 'submitter'
      ? { ...request, replies, answeredAt: message.at }
      : // The asker has come back: the question is open again, whatever was
        // said before.
        { ...request, replies, answeredAt: undefined };
  return next;
}

/** A question still waiting on a reply. */
export function isOpenQuestion(request: CommentRequest | null | undefined): boolean {
  return Boolean(request) && !request?.answeredAt;
}

/** Open questions on a submission, keyed by cell, oldest first. */
export function openQuestionEntries(
  requests: Record<string, CommentRequest> | undefined,
): [string, CommentRequest][] {
  return Object.entries(requests ?? {})
    .filter(([, r]) => isOpenQuestion(r))
    .sort((a, b) => a[1].requestedAt.localeCompare(b[1].requestedAt));
}

/** Keep a stored question marker only when it is complete enough to describe. */
function normalizeQuestioned(raw: unknown): ForecastQuestion | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Partial<ForecastQuestion>;
  if (typeof r.by !== 'string' || !r.by.trim()) return undefined;
  return {
    by: r.by,
    role: isRequesterRole(r.role) ? r.role : 'treasury',
    at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
  };
}

/**
 * How a status reads to a person. A returned forecast is stored as `rejected`,
 * which is the workflow's word, not the app's: everywhere else — the cycle
 * list, the checklist, the notification — it is "returned for update". The
 * pill said REJECTED, so the one place a submitter met the decision was the
 * one place it sounded final.
 */
export function statusLabel(status: SubmissionStatus): string {
  return status === 'rejected' ? 'returned' : status;
}

/** What a question's asker is CALLED to the person answering it. */
export function requesterLabel(role: RequesterRole | undefined): string {
  return role === 'approver' ? 'Approver' : 'Treasury';
}

/** What any participant in a thread is called, the answering side included. */
export function threadRoleLabel(role: ThreadRole): string {
  return role === 'submitter' ? 'Submitter' : requesterLabel(role);
}

/**
 * "Treasury", "your approver" or "Treasury and your approver" — who a
 * submitter's open questions are from, for the banner above their grid.
 */
export function requesterSummary(roles: Iterable<RequesterRole | undefined>): string {
  let treasury = false;
  let approver = false;
  for (const role of roles) {
    if (role === 'approver') approver = true;
    else treasury = true;
  }
  if (treasury && approver) return 'Treasury and your approver';
  if (approver) return 'your approver';
  return 'Treasury';
}

/** Fill in fields missing (or of the wrong type) in submissions stored by
 * older app versions, so downstream code can rely on the full shape. */
/**
 * Intercompany legs as stored. A leg with no counterparty or no usable amount
 * describes no movement at all, so it is dropped rather than kept as a row
 * that can never be mirrored — and a cell left with no legs is dropped with it.
 */
function normalizeLegs(raw: unknown): Record<string, IntercompanyLeg[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, IntercompanyLeg[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const legs: IntercompanyLeg[] = [];
    for (const item of value) {
      if (typeof item !== 'object' || item === null) continue;
      const leg = item as Partial<IntercompanyLeg>;
      if (typeof leg.id !== 'string' || typeof leg.counterparty !== 'string') continue;
      if (!leg.counterparty.trim() || typeof leg.amount !== 'number' || !Number.isFinite(leg.amount)) {
        continue;
      }
      const mirror = leg.mirrorOf;
      legs.push({
        id: leg.id,
        counterparty: leg.counterparty,
        amount: leg.amount,
        ...(mirror &&
        typeof mirror.entity === 'string' &&
        typeof mirror.legId === 'string' &&
        typeof mirror.sourceCellKey === 'string' &&
        typeof mirror.originalAmount === 'number'
          ? {
              mirrorOf: {
                entity: mirror.entity,
                legId: mirror.legId,
                sourceCellKey: mirror.sourceCellKey,
                originalAmount: mirror.originalAmount,
                at: typeof mirror.at === 'string' ? mirror.at : new Date().toISOString(),
                ...(mirror.afterSubmission === true ? { afterSubmission: true as const } : {}),
              },
            }
          : {}),
      });
    }
    if (legs.length > 0) out[key] = legs;
  }
  return out;
}

/** Stored disagreements, dropping any that no longer describe two figures. */
function normalizeMismatches(raw: unknown): Record<string, IntercompanyMismatch> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, IntercompanyMismatch> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const m = value as Partial<IntercompanyMismatch>;
    if (
      typeof m.cellKey !== 'string' ||
      typeof m.legId !== 'string' ||
      typeof m.counterparty !== 'string' ||
      typeof m.originalAmount !== 'number' ||
      typeof m.changedAmount !== 'number' ||
      typeof m.message !== 'string'
    ) {
      continue;
    }
    out[key] = {
      cellKey: m.cellKey,
      legId: m.legId,
      counterparty: m.counterparty,
      originalAmount: m.originalAmount,
      changedAmount: m.changedAmount,
      from: typeof m.from === 'string' ? m.from : 'Submitter',
      fromRole: isThreadRole(m.fromRole) ? m.fromRole : 'submitter',
      message: m.message,
      raisedAt: typeof m.raisedAt === 'string' ? m.raisedAt : new Date().toISOString(),
      replies: normalizeReplies(m.replies),
      ...(typeof m.settledAt === 'string' ? { settledAt: m.settledAt } : {}),
    };
  }
  return out;
}

function normalizeSubmission(sub: Submission): Submission {
  const record = (v: unknown): Record<string, never> | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, never>) : null;
  return {
    ...sub,
    status: typeof sub.status === 'string' ? sub.status : 'draft',
    values: record(sub.values) ?? {},
    flags: Array.isArray(sub.flags) ? sub.flags.filter((k) => typeof k === 'string') : [],
    resolvedFlags: Array.isArray(sub.resolvedFlags)
      ? sub.resolvedFlags.filter((k) => typeof k === 'string')
      : [],
    comments: record(sub.comments) ?? {},
    commentRequests: normalizeRequests(sub.commentRequests),
    // `reopenedBy` is what this was called while a question RETURNED the
    // forecast; the marker survived that change of meaning, so forecasts
    // stored then still say who is waiting on an answer.
    questionedBy: normalizeQuestioned(
      sub.questionedBy ?? (sub as { reopenedBy?: unknown }).reopenedBy,
    ),
    ...(typeof sub.revisedFrom === 'string' ? { revisedFrom: sub.revisedFrom } : {}),
    intercompany: normalizeLegs(sub.intercompany),
    mismatches: normalizeMismatches(sub.mismatches),
    dayComments: record(sub.dayComments) ?? {},
    startingBalance: typeof sub.startingBalance === 'number' ? sub.startingBalance : null,
    updatedAt: typeof sub.updatedAt === 'string' ? sub.updatedAt : new Date().toISOString(),
  };
}

/** Build the fresh (unsaved) submission a given (entity, week, template) would
 * start from: seeded demo values for the standard template (demo data only —
 * the live instance never invents numbers), blank otherwise. */
/**
 * The cells a forecast's numbers actually flag, by the rule the grid applies
 * on every edit: a move against the prior cycle beyond the entity's variance
 * threshold. Used to derive a demo forecast's flags from its own figures —
 * they were previously sprinkled at random, so the app asked for commentary
 * on cells that had not moved and left real swings unflagged.
 */
function varianceFlags(
  entity: string,
  week: string,
  template: ForecastTemplate,
  values: GridValues,
): string[] {
  const prior = getPriorValues(entity, week, template);
  const settings = settingsForEntity(entity, loadSettings(DEFAULT_SETTINGS));
  const periods = periodsOf(template).count;
  const flags: string[] = [];
  template.categories.forEach((cat, catIdx) => {
    if (cat.subtotal) return;
    for (let d = 0; d < periods; d++) {
      const key = `${catIdx}-${d}`;
      if (isVariance(values[key] || 0, priorValueFor(prior, catIdx, d, template), settings)) {
        flags.push(key);
      }
    }
  });
  return flags;
}

function buildSubmission(entity: string, week: string, template: ForecastTemplate): Submission {
  const seeded = DEMO_DATA && template.id === STANDARD_TEMPLATE_ID;
  const values = seeded
    ? generateGridValues(template.categories, week, entity).values
    // Templates authored in the editor can carry starting values.
    : { ...(template.defaultValues ?? {}) };
  const flags = seeded ? varianceFlags(entity, week, template, values) : [];

  return {
    period: week,
    entity,
    templateId: template.id,
    status: 'draft',
    values,
    flags,
    resolvedFlags: [],
    comments: {},
    commentRequests: {},
    intercompany: {},
    mismatches: {},
    dayComments: {},
    // Demo forecasts open with a balance; a real one starts blank until the
    // submitter enters theirs, and the running total appears with it.
    startingBalance: DEMO_DATA ? startingBalanceFor(entity) : null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Load the stored submission for (week, entity, template) or create and
 * persist a fresh one. The standard template seeds demo values; uploaded
 * templates start blank.
 */
export function getOrCreateSubmission(
  entity: string,
  week: string,
  template: ForecastTemplate,
): Submission {
  const stored = loadSubmission(week, entity, template.id);
  if (stored) return normalizeSubmission(stored);
  const fresh = buildSubmission(entity, week, template);
  saveSubmission(fresh);
  return fresh;
}

/**
 * Read-only view of a submission: the stored one if present, otherwise the
 * exact data a fresh one would be created with — WITHOUT persisting anything.
 * Used by aggregating screens (Dashboard, Consolidated, Comparisons) so they
 * reflect live edits while never creating storage entries as a side effect.
 */
export function peekSubmission(
  entity: string,
  week: string,
  template: ForecastTemplate,
): Submission {
  const stored = loadSubmission(week, entity, template.id);
  return stored ? normalizeSubmission(stored) : buildSubmission(entity, week, template);
}

// ---------------------------------------------------------------------------
// Draft checkpoints. The grid autosaves every keystroke, so "the stored
// submission" is always the latest edit — useless as a restore point. The
// Save Draft button records an explicit checkpoint here, and Reset returns
// to it (rather than to the seeded starting data).
// ---------------------------------------------------------------------------
const checkpointKey = (period: string, entity: string, templateId: string) =>
  `draftCheckpoint:${period}:${entity}:${templateId}`;

/** Record the state Save Draft was pressed on, as the restore point for Reset. */
export function saveDraftCheckpoint(sub: Submission): void {
  saveData(checkpointKey(sub.period, sub.entity, sub.templateId), sub);
}

/** The last explicitly saved draft for (week, entity, template), if any. */
export function loadDraftCheckpoint(
  period: string,
  entity: string,
  templateId: string,
): Submission | null {
  const raw = loadData<unknown>(checkpointKey(period, entity, templateId), null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return normalizeSubmission(raw as Submission);
}

/**
 * Whether a forecast has left the submitter's hands.
 *
 * Submitting is a handover, not a save: from that moment the numbers belong
 * to the approver and, after them, to treasury's consolidation. A submitter
 * editing them afterwards would silently change what someone else already
 * signed off on, so their grid goes read-only here and stays that way until
 * the forecast is RETURNED to them — a rejection puts it back in `draft`-like
 * territory and reopens editing.
 *
 * Commentary is deliberately not covered: answering a question about a cell
 * is not changing it, and that conversation carries on after the handover.
 */
export function isHandedOver(status: SubmissionStatus): boolean {
  return status === 'submitted' || status === 'approved' || status === 'consolidated';
}

/** What still blocks a clean submission: unfilled cells and unexplained flags. */
export interface SubmissionGaps {
  emptyCells: string[];
  uncommented: string[];
}

/**
 * Pre-submit validation, shared by the Submission screen and the checklist's
 * preview modal so both agree on what "ready to submit" means. Subtotal rows
 * are computed and never count; a stored 0 is a real answer.
 */
export function submissionGaps(sub: Submission, template: ForecastTemplate): SubmissionGaps {
  const periods = periodsOf(template).count;
  const emptyCells: string[] = [];
  template.categories.forEach((cat, catIdx) => {
    if (cat.subtotal) return;
    for (let d = 0; d < periods; d++) {
      if (sub.values[`${catIdx}-${d}`] === undefined) emptyCells.push(`${catIdx}-${d}`);
    }
  });
  const uncommented = sub.flags.filter((k) => !sub.comments?.[k]?.trim());
  return { emptyCells, uncommented };
}

/**
 * Submit a forecast without the Submission screen being open (the checklist's
 * preview modal). Writes the stored submission and reopens the approval
 * decision, exactly like submitting from the grid.
 */
export function submitStoredForecast(
  week: string,
  entity: string,
  templateId: string,
): Submission | null {
  const sub = materializeSubmission(week, entity, templateId);
  if (!sub) return null;
  const next: Submission = {
    ...sub,
    status: 'submitted',
    // Whatever this forecast was before its figures were revised, it is a
    // fresh submission now.
    revisedFrom: undefined,
    updatedAt: new Date().toISOString(),
  };
  saveSubmission(next);
  clearApprovalDecision(entity);
  return next;
}

/** A line item an entity forecasts on that the display template has no row for. */
export interface OmittedLine {
  label: string;
  entities: string[];
  /** Total value left out of the consolidated grid, in the grid's units. */
  total: number;
}

/** Aggregated grid across all entities for one week (standard template). */
export interface ConsolidatedData {
  values: GridValues;
  startingBalance: number;
  entityCount: number;
  /**
   * Line items that could not be mapped onto the display template and are
   * therefore absent from `values` — surfaced so the consolidated total is
   * never quietly smaller than the sum of its parts.
   */
  omitted: OmittedLine[];
}

/**
 * Aggregated grid for one week, laid out on `display`.
 *
 * Entities can be on different templates, so values are matched by line-item
 * LABEL rather than by position: an entity's "Receivables" lands on the
 * display template's "Receivables" whatever index it has in its own template.
 * Anything with no counterpart in the display template is left out rather
 * than silently landing on an unrelated row.
 */
export function consolidatedValues(
  week: string,
  display: ForecastTemplate,
  /** Restrict the aggregate to these entities (role scoping); omit for all. */
  onlyEntities?: string[],
): ConsolidatedData {
  const templates = loadTemplates();
  const overrides = loadApprovals(activeCycleId());
  const displayIdxByLabel = new Map<string, number>();
  display.categories.forEach((cat, i) => {
    if (!cat.subtotal) displayIdxByLabel.set(cat.label.trim().toLowerCase(), i);
  });

  const values: GridValues = {};
  let startingBalance = 0;
  const dropped = new Map<string, OmittedLine>();
  const all = onlyEntities
    ? listEntities().filter((e) => onlyEntities.includes(e.name))
    : listEntities();
  let included = 0;
  for (const e of all) {
    const template = templateForEntity(templates, e.name) ?? display;
    // The group position is what countries have actually REPORTED. A forecast
    // still being drafted (or returned for update) is not part of it — it used
    // to be, so treasury's headline total moved while a submitter was still
    // typing, and included countries the cycle-progress modal listed as
    // outstanding in the same breath.
    if (!isReceived(entityStatus(e.name, week, template.id, overrides))) continue;
    included += 1;
    const sub = peekSubmission(e.name, week, template);
    // Map this entity's category indexes onto the display template's.
    const remap = new Map<number, number>();
    template.categories.forEach((cat, i) => {
      if (cat.subtotal) return;
      const target = displayIdxByLabel.get(cat.label.trim().toLowerCase());
      if (target !== undefined) remap.set(i, target);
    });
    for (const [key, v] of Object.entries(sub.values)) {
      if (!v) continue;
      const [c, d] = key.split('-').map(Number);
      const target = remap.get(c);
      if (target === undefined) {
        // Nothing on the display template matches this line, so it is left
        // out. Record it rather than dropping it silently.
        const cat = template.categories[c];
        if (!cat || cat.subtotal) continue;
        const label = cat.label.trim();
        const entry = dropped.get(label.toLowerCase()) ?? { label, entities: [], total: 0 };
        if (!entry.entities.includes(e.name)) entry.entities.push(e.name);
        entry.total += v;
        dropped.set(label.toLowerCase(), entry);
        continue;
      }
      const outKey = `${target}-${d}`;
      values[outKey] = (values[outKey] || 0) + v;
    }
    startingBalance += sub.startingBalance ?? 0;
  }
  const omitted = [...dropped.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  // entityCount is what the total is made of, not who was asked — the modal
  // header says "8 entities" because eight forecasts are in this number.
  return { values, startingBalance, entityCount: included, omitted };
}

/**
 * An entity's effective workflow status for a week.
 *
 * The stored submission is the record; the cycle's approval map only carries a
 * decision that has not been written back yet. There is deliberately no third
 * fallback: a frozen seed status on the entity used to win over the stored
 * submission, which is how a forecast could read "approved" to treasury and
 * "still in draft" to the submitter who owned it.
 */
export function entityStatus(
  entity: string,
  week: string,
  templateId: string,
  overrides: ApprovalMap,
): SubmissionStatus {
  const stored = templateId ? loadSubmission(week, entity, templateId) : null;
  if (stored) return stored.status;
  return overrides[entity] ?? 'draft';
}

/** Has a forecast been handed to the approver (or beyond)? */
export function isReceived(status: SubmissionStatus): boolean {
  return status === 'submitted' || status === 'approved' || status === 'consolidated';
}

/**
 * Prior-week values used for variance comparison and "Copy Prior Forecast":
 * the stored previous-week submission if one exists, otherwise (standard
 * template only) deterministic generated data, otherwise blank.
 */
export function getPriorValues(
  entity: string,
  week: string,
  template: ForecastTemplate,
): GridValues {
  const prevKey = prevWeekKey(week);
  const stored = loadSubmission(prevKey, entity, template.id);
  if (stored) return stored.values;
  if (DEMO_DATA && template.id === STANDARD_TEMPLATE_ID) {
    return generateGridValues(template.categories, prevKey, entity).values;
  }
  return {};
}

/**
 * The prior-week value that corresponds to a current-horizon cell. Horizons
 * roll by one week, so on a daily template current day d falls on the same
 * calendar date as prior day d + 5 working days. Returns null for the tail of
 * the horizon, which the prior submission did not cover.
 */
export function priorValueFor(
  prior: GridValues,
  catIdx: number,
  dayIdx: number,
  /**
   * The template the cell belongs to — it decides both the horizon length and
   * how far the horizon rolls. Omitted, the classic 20-working-day horizon
   * applies, which is what an uploaded workbook uses.
   */
  template?: Pick<ForecastTemplate, 'periods'> | null,
): number | null {
  // No prior forecast at all (a live instance's first week, or a template
  // never submitted before): there is nothing to compare against, so no
  // cell has a meaningful variance — as opposed to a prior value of 0.
  let hasPrior = false;
  for (const k in prior) {
    void k;
    hasPrior = true;
    break;
  }
  if (!hasPrior) return null;
  const shifted = dayIdx + rollShift(template);
  if (shifted >= periodsOf(template).count) return null;
  return prior[`${catIdx}-${shifted}`] || 0;
}

/**
 * The variance rules that apply to one entity: the group defaults from
 * Settings, with the threshold Legal Entity Setup configures for that entity
 * layered on top. Every variance computation goes through this, so a
 * per-entity threshold is honoured on the grid, the dashboard and the
 * comments queue alike.
 */
export function settingsForEntity(entity: string, base: Settings): Settings {
  const configured = listLegalEntities().find((e) => e.name === entity)?.varianceThreshold;
  return typeof configured === 'number' && configured > 0
    ? { ...base, varianceThreshold: configured }
    : base;
}

/** Does an edited cell breach the variance threshold vs its prior value? */
export function isVariance(
  current: number,
  prior: number | null,
  settings: Settings,
): boolean {
  if (prior === null) {
    // Days beyond the prior horizon: flag only if the admin disabled the exemption.
    if (settings.exemptNewPeriods.startsWith('Yes')) return false;
    prior = 0;
  }
  const minAbs = Number(String(settings.minValueToTrigger).replace(/[,\s]/g, '')) / 1000 || 0;
  if (Math.abs(current) < minAbs) return false;
  const pct = (Math.abs(current - prior) / Math.max(Math.abs(prior), 1)) * 100;
  return pct > settings.varianceThreshold;
}

/**
 * Templates available for an entity. Legal Entity Setup is authoritative:
 * the template configured there comes first, then any template assigned to
 * the entity on the Templates screen, then everything else as a fallback.
 */
export function templatesForEntity(
  templates: ForecastTemplate[],
  entity: string,
): ForecastTemplate[] {
  const configuredId = listLegalEntities().find((e) => e.name === entity)?.forecastTemplateId;
  const configured = configuredId ? templates.find((t) => t.id === configuredId) : undefined;
  const assigned = templates.filter(
    (t) => t.assignedEntities.includes(entity) && t.id !== configured?.id,
  );
  const ordered = [...(configured ? [configured] : []), ...assigned];
  return ordered.length > 0 ? ordered : templates;
}

/**
 * The template an entity actually submits on — Legal Entity Setup decides.
 *
 * Every aggregate screen used to assume the standard template, so a forecast
 * submitted on any other one was invisible: it never reached the dashboard,
 * the consolidated position, the comparisons or the approval queue.
 */
export function templateForEntity(
  templates: ForecastTemplate[],
  entity: string,
): ForecastTemplate | null {
  return templatesForEntity(templates, entity)[0] ?? null;
}

/** An entity's current submission, read on its own template. */
export function peekEntitySubmission(
  entity: string,
  week: string,
  templates: ForecastTemplate[],
): { submission: Submission; template: ForecastTemplate } | null {
  const template = templateForEntity(templates, entity);
  if (!template) return null;
  return { submission: peekSubmission(entity, week, template), template };
}

/** One cell-level week-over-week variance, computed from live data. */
export interface VarianceRow {
  entity: string;
  category: string;
  /** Cell coordinates, so a caller can deep-link straight to it. */
  catIdx: number;
  dayIdx: number;
  prior: number;
  current: number;
  /** Null when a percentage would mislead — see `pctChange`. */
  pct: number | null;
  /** Submitter commentary, if the cell is flagged and explained. */
  comment: string;
  flagged: boolean;
}

/**
 * The largest week-over-week cell variances across all entities, computed
 * from the same data the Submission screen edits (stored submissions, demo
 * data otherwise). Sorted by absolute delta, capped at `limit`.
 */
export function largestVariances(
  week: string,
  template: ForecastTemplate,
  settings: Settings,
  limit = 12,
  /** Restrict the scan to these entities (role scoping); omit for all. */
  onlyEntities?: string[],
): VarianceRow[] {
  const rows: VarianceRow[] = [];
  const templates = loadTemplates();
  const scanned = onlyEntities
    ? listEntities().filter((e) => onlyEntities.includes(e.name))
    : listEntities();
  for (const e of scanned) {
    // Each entity is scanned on the template it actually submits on, against
    // its own variance threshold.
    const entityTemplate = templateForEntity(templates, e.name) ?? template;
    const entitySettings = settingsForEntity(e.name, settings);
    const sub = peekSubmission(e.name, week, entityTemplate);
    const prior = getPriorValues(e.name, week, entityTemplate);
    const periods = periodsOf(entityTemplate).count;
    entityTemplate.categories.forEach((cat, catIdx) => {
      for (let d = 0; d < periods; d++) {
        const key = `${catIdx}-${d}`;
        const current = sub.values[key] || 0;
        const prev = priorValueFor(prior, catIdx, d, entityTemplate);
        if (prev === null) continue; // beyond the prior horizon
        if (!isVariance(current, prev, entitySettings)) continue;
        rows.push({
          entity: e.name,
          category: cat.label,
          catIdx,
          dayIdx: d,
          prior: prev,
          current,
          pct: pctChange(current, prev),
          comment: sub.comments?.[key]?.trim() ?? '',
          flagged: sub.flags.includes(key),
        });
      }
    });
  }
  rows.sort((a, b) => Math.abs(b.current - b.prior) - Math.abs(a.current - a.prior));
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// The forecasts a review screen looks across.
//
// There is one review screen now — the questions board — and it reads this.
// The comment-by-comment queue it replaced collected every flagged cell on
// every forecast, which was hundreds of rows of the submitters' own
// commentary: written to be read beside the numbers it explains, not in a
// list of its own.
// ---------------------------------------------------------------------------

/**
 * Every submission a review screen should consider, without duplicates: the
 * current week for EVERY entity (stored, or the same deterministic demo data
 * the other screens show — `peek` writes nothing), plus every submission
 * actually stored, which is what covers historical weeks and other templates.
 *
 * Shared so the questions queue and any other cross-forecast screen can
 * never disagree about which forecasts exist.
 */
export function reviewCandidates(templates: ForecastTemplate[]): Submission[] {
  const week = currentWeekKey();
  const candidates: Submission[] = [];
  for (const e of listEntities()) {
    const template = templatesForEntity(templates, e.name)[0];
    if (template) candidates.push(peekSubmission(e.name, week, template));
  }
  candidates.push(...listSubmissions());
  const seen = new Set<string>();
  return candidates.filter((sub) => {
    const id = `${sub.period}:${sub.entity}:${sub.templateId}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The submission a review action targets: the stored one, or — for a
 * current-week demo forecast that was never opened — the same generated
 * submission persisted first, so the resolution has something to stick to.
 */
function materializeSubmission(
  period: string,
  entity: string,
  templateId: string,
): Submission | null {
  const stored = loadSubmission(period, entity, templateId);
  if (stored) return normalizeSubmission(stored);
  const template = loadTemplates().find((t) => t.id === templateId);
  if (!template) return null;
  return getOrCreateSubmission(entity, period, template);
}

/** Mark one flagged cell reviewed/unreviewed on the submission. */
export function setFlagResolved(
  period: string,
  entity: string,
  templateId: string,
  key: string,
  resolved: boolean,
): void {
  const sub = materializeSubmission(period, entity, templateId);
  if (!sub) return;
  const set = new Set(sub.resolvedFlags);
  if (resolved) set.add(key);
  else set.delete(key);
  saveSubmission({ ...sub, resolvedFlags: [...set] });
}

/**
 * Ask the submitter for commentary on one cell.
 *
 * Works on ANY cell, not just a flagged one: treasury's question is about the
 * number, and the variance threshold is not the only reason to have one. The
 * request also flags the cell, so it shows up on the submitter's grid and in
 * the review queue alongside the threshold breaches.
 */
export function requestComment(
  period: string,
  entity: string,
  templateId: string,
  key: string,
  request: CommentRequest,
): void {
  const sub = materializeSubmission(period, entity, templateId);
  if (!sub) return;
  const flags = new Set(sub.flags);
  flags.add(key);
  // A question does NOT send the forecast back.
  //
  // It used to: being asked about a number returned the whole forecast to
  // draft and cleared the approval, so one question undid an approver's
  // decision and a submitter who only had a sentence to write was handed a
  // forecast to submit all over again. What a question actually creates is a
  // REPLY owed — the figures stand until somebody changes one, which is a
  // separate act with its own consequence (see `revisedFrom`).
  // Asking again about the same cell CONTINUES the conversation. Storing the
  // new question on its own dropped everything said before it, so a follow-up
  // erased the answer it was following up on.
  const commentRequests = sub.commentRequests?.[key]
    ? withThreadMessage(sub.commentRequests, key, {
        from: request.from,
        role: request.fromRole ?? 'treasury',
        text: request.message,
        at: request.requestedAt,
      })
    : { ...(sub.commentRequests ?? {}), [key]: request };
  saveSubmission({
    ...sub,
    flags: [...flags],
    resolvedFlags: (sub.resolvedFlags ?? []).filter((k) => k !== key),
    commentRequests,
    // Who is waiting, so every screen can say the forecast is in review
    // rather than showing a handed-over forecast with nothing going on.
    questionedBy: {
      by: request.from,
      role: request.fromRole ?? 'treasury',
      at: request.requestedAt,
    },
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Add one message to the thread on a cell and persist it.
 *
 * Used by the questions board, where the conversation happens away from the
 * grid. The forecast screen holds the whole submission in local state and
 * saves it in one go, so it composes with `withThreadMessage` instead.
 */
export function postThreadMessage(
  period: string,
  entity: string,
  templateId: string,
  key: string,
  message: ThreadMessage,
): Submission | null {
  const sub = materializeSubmission(period, entity, templateId);
  if (!sub?.commentRequests?.[key]) return null;
  const commentRequests = withThreadMessage(sub.commentRequests, key, message);
  const next: Submission = {
    ...sub,
    commentRequests,
    // The submitter's latest reply IS the cell's commentary — the variance on
    // it is explained by whatever they last said about it.
    comments:
      message.role === 'submitter'
        ? { ...sub.comments, [key]: message.text }
        : sub.comments,
    // Coming back with a follow-up puts the question back in play, so a cell
    // closed off earlier stops counting as reviewed.
    resolvedFlags:
      message.role === 'submitter'
        ? (sub.resolvedFlags ?? [])
        : (sub.resolvedFlags ?? []).filter((k) => k !== key),
    ...(message.role === 'submitter'
      ? {}
      : { questionedBy: { by: message.from, role: message.role, at: message.at } }),
    updatedAt: new Date().toISOString(),
  };
  saveSubmission(next);
  return next;
}

/** Questions on this forecast that are still waiting on a reply. */
export function hasOpenQuestions(sub: Submission): boolean {
  return openQuestionEntries(sub.commentRequests).length > 0;
}

/**
 * The question to TELL people about: one somebody still owes a reply to. Once
 * every thread has been answered the forecast is not "in review" any more, so
 * the marker stops being news.
 */
export function activeQuestion(sub: Submission): ForecastQuestion | null {
  return hasOpenQuestions(sub) ? (sub.questionedBy ?? null) : null;
}

/**
 * May the numbers still be changed?
 *
 * Inside an open cycle they can: a question is often answered by correcting
 * the figure, and a submitter who spots a mistake before treasury consolidates
 * should fix it rather than wait to be asked. Doing so withdraws the forecast
 * from approval (see `revisedFrom`) so the corrected numbers go round the
 * cycle again. Once the cycle closes — or the forecast is consolidated into
 * the group position — the figures are history and only the conversation
 * about them carries on.
 */
export function figuresEditable(status: SubmissionStatus, cycleOpen: boolean): boolean {
  return cycleOpen && status !== 'consolidated';
}

// ---------------------------------------------------------------------------
// Unseen questions. A submitter who returns to a reopened forecast should not
// have to hunt for the cells that were asked about, so the first visit after a
// question lands on them.
// ---------------------------------------------------------------------------
const seenKey = (period: string, entity: string, templateId: string) =>
  `requestsSeen:${period}:${entity}:${templateId}`;

/**
 * Cells with an open question the submitter has not been shown yet, oldest
 * question first. Empty once `markRequestsSeen` has run for this forecast.
 */
export function unseenRequestKeys(sub: Submission): string[] {
  const since = loadData<string>(seenKey(sub.period, sub.entity, sub.templateId), '');
  return openQuestionEntries(sub.commentRequests)
    .filter(([key, req]) => !sub.comments?.[key]?.trim() && (!since || req.requestedAt > since))
    .map(([key]) => key);
}

/** Record that the submitter has now been shown the outstanding questions. */
export function markRequestsSeen(sub: Submission): void {
  saveData(seenKey(sub.period, sub.entity, sub.templateId), new Date().toISOString());
}

/**
 * The submitter's answer to the question on a cell, as a new requests map.
 *
 * The question is STAMPED and kept, never deleted: whoever asked comes back to
 * a cell carrying a paragraph of commentary, and deleting the question left
 * nothing to say what that paragraph was answering. The answer joins the
 * thread, so a conversation several exchanges long reads as one.
 *
 * Returns the map unchanged when the cell has no question — commentary written
 * on a cell nobody asked about is just commentary.
 */
export function answerCommentRequest(
  requests: Record<string, CommentRequest> | undefined,
  key: string,
  answer: string,
  submitter: string,
): Record<string, CommentRequest> {
  if (!requests?.[key] || !answer.trim()) return { ...(requests ?? {}) };
  return withThreadMessage(requests, key, {
    from: submitter,
    role: 'submitter',
    text: answer.trim(),
    at: new Date().toISOString(),
  });
}

/** The cycle decisions are recorded against — one definition, in cycleService. */
export function activeCycleId(): string {
  return activeCycle().id;
}

/**
 * Record an approver's decision so BOTH stores agree: the cycle's approval
 * map (what the queue reads) and the stored submission itself (what the
 * submitter's screen reads). Writing only the map meant a decision on a
 * never-opened forecast was invisible to its submitter.
 */
export function applyApprovalDecision(
  week: string,
  entity: string,
  templateId: string,
  status: SubmissionStatus,
): ApprovalMap {
  const cycleId = activeCycleId();
  const next = { ...loadApprovals(cycleId), [entity]: status };
  saveApprovals(cycleId, next);
  const sub = materializeSubmission(week, entity, templateId);
  if (sub) saveSubmission({ ...sub, status, updatedAt: new Date().toISOString() });
  return next;
}

/**
 * Reopen an entity's decision when its forecast is (re)submitted. Without
 * this, a rejection stuck to the entity forever: the resubmitted forecast
 * arrived in the queue already showing "rejected", with no way to approve it.
 */
export function clearApprovalDecision(entity: string): void {
  const cycleId = activeCycleId();
  const overrides = loadApprovals(cycleId);
  if (!(entity in overrides)) return;
  const next = { ...overrides };
  delete next[entity];
  saveApprovals(cycleId, next);
}

/**
 * Entities whose forecast is in an approver's queue for a week.
 *
 * The Approvals screen and the analyst checklist both need this, and two
 * versions of "what is waiting for me" would drift apart, so it lives here.
 */
export function approvalQueue(week: string, onlyEntities?: string[]): Entity[] {
  const templates = loadTemplates();
  const overrides = loadApprovals(activeCycleId());
  return listEntities().filter((e) => {
    if (onlyEntities && !onlyEntities.includes(e.name)) return false;
    const templateId = templateForEntity(templates, e.name)?.id ?? '';
    const status = entityStatus(e.name, week, templateId, overrides);
    // Anything that ARRIVED this cycle stays listed — including forecasts
    // already decided, shown with their decision, so the approver keeps sight
    // of what they just did. A forecast that has never been submitted is not
    // in anyone's queue: offering a decision on it is how the app used to let
    // an approval invent a submission that was never made.
    return isReceived(status) || status === 'rejected';
  });
}

/** How many queued forecasts still need a decision (approved/rejected). */
export function pendingApprovalCount(
  week: string,
  overrides: ApprovalMap,
  onlyEntities?: string[],
): number {
  const templates = loadTemplates();
  return approvalQueue(week, onlyEntities).filter((e) => {
    const templateId = templateForEntity(templates, e.name)?.id ?? '';
    const status = entityStatus(e.name, week, templateId, overrides);
    return status !== 'approved' && status !== 'rejected';
  }).length;
}

/** Mark every flagged cell of a submission as reviewed. */
export function resolveAllFlags(period: string, entity: string, templateId: string): void {
  const sub = materializeSubmission(period, entity, templateId);
  if (!sub) return;
  saveSubmission({ ...sub, resolvedFlags: [...sub.flags] });
}
