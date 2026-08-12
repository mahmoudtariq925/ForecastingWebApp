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
  ForecastReopen,
  ForecastTemplate,
  RequesterRole,
  Settings,
  Submission,
  SubmissionStatus,
} from '../types';
import {
  generateGridValues,
  seedFor,
  STANDARD_TEMPLATE_ID,
  startingBalanceFor,
} from './mockData';
import { listEntities } from './appData';
import { activeCycle } from './cycleService';
import { DEMO_DATA } from './dataSource';
import { listLegalEntities } from './legalEntityService';
import {
  currentWeekKey,
  periodsOf,
  prevWeekKey,
  rollShift,
  templateDayLabels,
} from './periods';
import {
  listSubmissions,
  loadApprovals,
  loadData,
  loadSubmission,
  loadTemplates,
  saveApprovals,
  saveData,
  saveSubmission,
  type ApprovalMap,
} from '../storage/localStorage';
import type { GridValues } from '../components/submissions/gridMath';

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

/** Keep only well-formed comment requests — storage can hold anything. */
function normalizeRequests(raw: unknown): Record<string, CommentRequest> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, CommentRequest> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const r = value as Partial<CommentRequest>;
    if (typeof r.message !== 'string' || !r.message.trim()) continue;
    out[key] = {
      from: typeof r.from === 'string' ? r.from : 'Treasury',
      // Questions stored before roles were recorded were treasury's: the
      // approver could not ask from anywhere until this release.
      fromRole: isRequesterRole(r.fromRole) ? r.fromRole : 'treasury',
      message: r.message,
      requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : new Date().toISOString(),
      ...(typeof r.answeredAt === 'string' ? { answeredAt: r.answeredAt } : {}),
    };
  }
  return out;
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

/** Keep a stored reopening only when it is complete enough to describe. */
function normalizeReopen(raw: unknown): ForecastReopen | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Partial<ForecastReopen>;
  if (typeof r.by !== 'string' || !r.by.trim()) return undefined;
  return {
    by: r.by,
    role: isRequesterRole(r.role) ? r.role : 'treasury',
    at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
  };
}

/** What a question's asker is CALLED to the person answering it. */
export function requesterLabel(role: RequesterRole | undefined): string {
  return role === 'approver' ? 'Approver' : 'Treasury';
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
    reopenedBy: normalizeReopen(sub.reopenedBy),
    dayComments: record(sub.dayComments) ?? {},
    startingBalance: typeof sub.startingBalance === 'number' ? sub.startingBalance : null,
    updatedAt: typeof sub.updatedAt === 'string' ? sub.updatedAt : new Date().toISOString(),
  };
}

/** Build the fresh (unsaved) submission a given (entity, week, template) would
 * start from: seeded demo values for the standard template (demo data only —
 * the live instance never invents numbers), blank otherwise. */
function buildSubmission(entity: string, week: string, template: ForecastTemplate): Submission {
  const seeded = DEMO_DATA && template.id === STANDARD_TEMPLATE_ID;
  const { values, flags } = seeded
    ? generateGridValues(template.categories, week, seedFor(`${entity}:${week}`), true)
    // Templates authored in the editor can carry starting values.
    : { values: { ...(template.defaultValues ?? {}) }, flags: [] as string[] };

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
  const next: Submission = { ...sub, status: 'submitted', updatedAt: new Date().toISOString() };
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
    return generateGridValues(
      template.categories,
      prevKey,
      seedFor(`${entity}:${prevKey}`),
      false,
    ).values;
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
// Comment review (admin). A forecast is "blocked" while it has flagged cells
// an admin has not yet marked as reviewed/resolved. All of this reads and
// writes the same stored submissions the Submission screen edits.
// ---------------------------------------------------------------------------

/** One flagged cell of a submission, prepared for the review screen. */
export interface ReviewItem {
  key: string;
  catIdx: number;
  dayIdx: number;
  category: string;
  /** "Mon 20/7" */
  dateLabel: string;
  current: number;
  prior: number | null;
  pct: number | null;
  /** Submitter commentary; empty = still missing. */
  comment: string;
  resolved: boolean;
  /** An open treasury question on this cell, if there is one. */
  request: CommentRequest | null;
}

/** All review-relevant content of one stored submission. */
export interface ReviewGroup {
  /** Stable id: `period:entity:templateId`. */
  id: string;
  entity: string;
  period: string;
  templateId: string;
  templateName: string;
  submitter: string;
  status: SubmissionStatus;
  updatedAt: string;
  items: ReviewItem[];
  /** Free-text day comments (context, nothing to resolve). */
  dayNotes: { dayIdx: number; dateLabel: string; text: string }[];
  unresolved: number;
  needsCommentary: number;
}

/**
 * Collect every forecast with flagged cells or day comments, grouped per
 * forecast and enriched with labels/prior values for display. Coverage
 * matches the rest of the app: the current week is included for EVERY
 * entity (stored submission or the same deterministic demo data the other
 * screens show), plus any stored submission from other weeks. Malformed
 * legacy storage entries are skipped rather than crashing the screen.
 */
export function collectReviewGroups(templates: ForecastTemplate[]): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  const seen = new Set<string>();

  // Current week across all entities (peek = stored-or-demo, no writes)…
  const week = currentWeekKey();
  const allEntities = listEntities();
  const candidates: Submission[] = [];
  for (const e of allEntities) {
    const template = templatesForEntity(templates, e.name)[0];
    if (template) candidates.push(peekSubmission(e.name, week, template));
  }
  // …plus everything actually stored (historical weeks, other templates).
  candidates.push(...listSubmissions());

  for (const raw of candidates) {
    const id = `${raw.period}:${raw.entity}:${raw.templateId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const sub = normalizeSubmission(raw);
      if (sub.flags.length === 0 && Object.keys(sub.dayComments).length === 0) continue;

      const template = templates.find((t) => t.id === sub.templateId);
      // Labels follow the submission's own template, so a 30-period forecast
      // still names every flagged column instead of falling back to "Day n".
      const labels = templateDayLabels(template, sub.period);
      const prior = template ? getPriorValues(sub.entity, sub.period, template) : {};
      const resolved = new Set(sub.resolvedFlags);

      const items: ReviewItem[] = sub.flags.map((key) => {
        const [c, d] = key.split('-').map(Number);
        const current = sub.values[key] || 0;
        const prev = template ? priorValueFor(prior, c, d, template) : null;
        return {
          key,
          catIdx: c,
          dayIdx: d,
          category: template?.categories[c]?.label ?? `Line ${c + 1}`,
          dateLabel: labels[d] ? `${labels[d].dow} ${labels[d].dm}` : `Day ${d + 1}`,
          current,
          prior: prev,
          pct: prev === null ? null : pctChange(current, prev),
          comment: sub.comments[key]?.trim() ?? '',
          resolved: resolved.has(key),
          request: sub.commentRequests?.[key] ?? null,
        };
      });
      // Biggest movers first — the size of the swing is what decides whether a
      // comment is worth reading, so that is the only ordering that matters.
      items.sort(
        (a, b) =>
          Math.abs(b.current - (b.prior ?? 0)) - Math.abs(a.current - (a.prior ?? 0)),
      );

      const dayNotes = Object.entries(sub.dayComments)
        .filter(([, text]) => String(text).trim())
        .map(([d, text]) => ({
          dayIdx: Number(d),
          dateLabel: labels[Number(d)]
            ? `${labels[Number(d)].dow} ${labels[Number(d)].dm}`
            : `Day ${Number(d) + 1}`,
          text: String(text),
        }))
        .sort((a, b) => a.dayIdx - b.dayIdx);

      groups.push({
        id,
        entity: sub.entity,
        period: sub.period,
        templateId: sub.templateId,
        templateName: template?.name ?? sub.templateId,
        submitter: allEntities.find((e) => e.name === sub.entity)?.submitter ?? '—',
        status: sub.status,
        updatedAt: sub.updatedAt,
        items,
        dayNotes,
        unresolved: items.filter((i) => !i.resolved).length,
        needsCommentary: items.filter((i) => !i.comment && !i.resolved).length,
      });
    } catch (err) {
      console.warn(`[review] skipped malformed submission "${id}"`, err);
    }
  }
  // Most blocked first, newest week first within equal counts.
  groups.sort((a, b) => b.unresolved - a.unresolved || b.period.localeCompare(a.period));
  return groups;
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
  // A question reopens the forecast, not just the cell.
  //
  // Being asked about a number means the forecast is back with the person who
  // produced it: they may need to correct it, not merely describe it. So a
  // handed-over forecast returns to draft and its approval is cleared, which
  // puts it in front of the submitter AND back in the approver's queue once
  // it is resubmitted — including when treasury asks after an approval has
  // already been given.
  const reopened = isHandedOver(sub.status);
  saveSubmission({
    ...sub,
    status: reopened ? 'draft' : sub.status,
    flags: [...flags],
    resolvedFlags: (sub.resolvedFlags ?? []).filter((k) => k !== key),
    commentRequests: { ...(sub.commentRequests ?? {}), [key]: request },
    // Remember that this draft is a REOPENED forecast, not a new one — a
    // submitter coming back to it was otherwise told they were starting over.
    reopenedBy: reopened
      ? { by: request.from, role: request.fromRole ?? 'treasury', at: request.requestedAt }
      : sub.reopenedBy,
    updatedAt: new Date().toISOString(),
  });
  if (reopened) clearApprovalDecision(entity);
}

/**
 * The reopening to TELL the submitter about: one that explains the state the
 * forecast is in right now. A resubmitted forecast has moved on, so its record
 * of having once been reopened is history rather than news.
 */
export function activeReopen(sub: Submission): ForecastReopen | null {
  return sub.status === 'draft' ? (sub.reopenedBy ?? null) : null;
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
 * Close the question on a cell — the submitter has answered it.
 *
 * The request is STAMPED, not deleted: whoever asked comes back to a cell
 * carrying a paragraph of commentary, and deleting the question left nothing
 * to say what that paragraph was answering. It stops counting as open the
 * moment `answeredAt` is set.
 */
export function answerCommentRequest(sub: Submission, key: string): Submission['commentRequests'] {
  const requests = { ...(sub.commentRequests ?? {}) };
  const request = requests[key];
  if (!request) return requests;
  requests[key] = { ...request, answeredAt: new Date().toISOString() };
  return requests;
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
