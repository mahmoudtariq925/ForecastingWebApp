// ============================================================================
// Submission lifecycle helpers shared by the Submission screen, the Dashboard
// KPIs, the Consolidated view and the Comparison/Review screens. Sits on top
// of the storage layer; knows how to seed demo data for the standard template
// and how rolling weekly horizons align for variance comparison.
//
// Every screen that shows forecast numbers goes through these helpers, so an
// edit on the Submission screen is reflected everywhere else.
// ============================================================================
import type { Entity, ForecastTemplate, Settings, Submission, SubmissionStatus } from '../types';
import {
  entities,
  generateGridValues,
  seedFor,
  STANDARD_TEMPLATE_ID,
  startingBalanceFor,
} from './mockData';
import { dayLabelsForWeek, HORIZON_DAYS, prevWeekKey, WORKDAYS_PER_WEEK } from './periods';
import {
  listSubmissions,
  loadSubmission,
  saveSubmission,
  type ApprovalMap,
} from '../storage/localStorage';
import type { GridValues } from '../components/submissions/gridMath';

/** Build the fresh (unsaved) submission a given (entity, week, template) would
 * start from: seeded demo values for the standard template, blank otherwise. */
function buildSubmission(entity: string, week: string, template: ForecastTemplate): Submission {
  const isStandard = template.id === STANDARD_TEMPLATE_ID;
  const { values, flags } = isStandard
    ? generateGridValues(template.categories, week, seedFor(`${entity}:${week}`), true)
    : { values: {}, flags: [] };

  return {
    period: week,
    entity,
    templateId: template.id,
    status: 'draft',
    values,
    flags,
    resolvedFlags: [],
    comments: {},
    dayComments: {},
    startingBalance: startingBalanceFor(entity),
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
  if (stored) return stored;
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
  return loadSubmission(week, entity, template.id) ?? buildSubmission(entity, week, template);
}

/** Aggregated grid across all entities for one week (standard template). */
export interface ConsolidatedData {
  values: GridValues;
  startingBalance: number;
  entityCount: number;
}

export function consolidatedValues(week: string, template: ForecastTemplate): ConsolidatedData {
  const values: GridValues = {};
  let startingBalance = 0;
  for (const e of entities) {
    const sub = peekSubmission(e.name, week, template);
    for (const [key, v] of Object.entries(sub.values)) {
      if (v) values[key] = (values[key] || 0) + v;
    }
    startingBalance += sub.startingBalance ?? 0;
  }
  return { values, startingBalance, entityCount: entities.length };
}

/**
 * An entity's effective workflow status for a week: an approver's decision
 * wins, then the stored submission's own status, then the seed status.
 */
export function mergedEntityStatus(
  entity: Entity,
  week: string,
  templateId: string,
  overrides: ApprovalMap,
): SubmissionStatus {
  const override = overrides[entity.name];
  if (override) return override;
  const stored = loadSubmission(week, entity.name, templateId);
  if (stored && stored.status !== 'draft') return stored.status;
  return entity.status;
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
  if (template.id === STANDARD_TEMPLATE_ID) {
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
 * roll by one week, so current day d falls on the same calendar date as
 * prior day d + 5 working days. Returns null for the final week of the
 * horizon, which the prior submission did not cover.
 */
export function priorValueFor(
  prior: GridValues,
  catIdx: number,
  dayIdx: number,
): number | null {
  const shifted = dayIdx + WORKDAYS_PER_WEEK;
  if (shifted >= HORIZON_DAYS) return null;
  return prior[`${catIdx}-${shifted}`] || 0;
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

/** Templates assigned to an entity, falling back to all templates. */
export function templatesForEntity(
  templates: ForecastTemplate[],
  entity: string,
): ForecastTemplate[] {
  const assigned = templates.filter((t) => t.assignedEntities.includes(entity));
  return assigned.length > 0 ? assigned : templates;
}

/** One cell-level week-over-week variance, computed from live data. */
export interface VarianceRow {
  entity: string;
  category: string;
  dayIdx: number;
  prior: number;
  current: number;
  pct: number;
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
): VarianceRow[] {
  const rows: VarianceRow[] = [];
  for (const e of entities) {
    const sub = peekSubmission(e.name, week, template);
    const prior = getPriorValues(e.name, week, template);
    template.categories.forEach((cat, catIdx) => {
      for (let d = 0; d < HORIZON_DAYS; d++) {
        const key = `${catIdx}-${d}`;
        const current = sub.values[key] || 0;
        const prev = priorValueFor(prior, catIdx, d);
        if (prev === null) continue; // beyond the prior horizon
        if (!isVariance(current, prev, settings)) continue;
        rows.push({
          entity: e.name,
          category: cat.label,
          dayIdx: d,
          prior: prev,
          current,
          pct: ((current - prev) / Math.max(Math.abs(prev), 1)) * 100,
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
 * Collect every stored submission that has flagged cells or day comments,
 * grouped per forecast and enriched with labels/prior values for display.
 */
export function collectReviewGroups(templates: ForecastTemplate[]): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  for (const sub of listSubmissions()) {
    const flagCount = sub.flags?.length ?? 0;
    const dayNoteCount = Object.keys(sub.dayComments ?? {}).length;
    if (flagCount === 0 && dayNoteCount === 0) continue;

    const template = templates.find((t) => t.id === sub.templateId);
    const labels = dayLabelsForWeek(sub.period);
    const prior = template ? getPriorValues(sub.entity, sub.period, template) : {};
    const resolved = new Set(sub.resolvedFlags ?? []);

    const items: ReviewItem[] = (sub.flags ?? []).map((key) => {
      const [c, d] = key.split('-').map(Number);
      const current = sub.values[key] || 0;
      const prev = template ? priorValueFor(prior, c, d) : null;
      return {
        key,
        catIdx: c,
        dayIdx: d,
        category: template?.categories[c]?.label ?? `Line ${c + 1}`,
        dateLabel: labels[d] ? `${labels[d].dow} ${labels[d].dm}` : `Day ${d + 1}`,
        current,
        prior: prev,
        pct: prev === null ? null : ((current - prev) / Math.max(Math.abs(prev), 1)) * 100,
        comment: sub.comments?.[key]?.trim() ?? '',
        resolved: resolved.has(key),
      };
    });
    // Unresolved first, then by absolute delta so the big movers lead.
    items.sort(
      (a, b) =>
        Number(a.resolved) - Number(b.resolved) ||
        Math.abs(b.current - (b.prior ?? 0)) - Math.abs(a.current - (a.prior ?? 0)),
    );

    const dayNotes = Object.entries(sub.dayComments ?? {})
      .filter(([, text]) => text.trim())
      .map(([d, text]) => ({
        dayIdx: Number(d),
        dateLabel: labels[Number(d)]
          ? `${labels[Number(d)].dow} ${labels[Number(d)].dm}`
          : `Day ${Number(d) + 1}`,
        text,
      }))
      .sort((a, b) => a.dayIdx - b.dayIdx);

    groups.push({
      id: `${sub.period}:${sub.entity}:${sub.templateId}`,
      entity: sub.entity,
      period: sub.period,
      templateId: sub.templateId,
      templateName: template?.name ?? sub.templateId,
      submitter: entities.find((e) => e.name === sub.entity)?.submitter ?? '—',
      status: sub.status,
      updatedAt: sub.updatedAt,
      items,
      dayNotes,
      unresolved: items.filter((i) => !i.resolved).length,
      needsCommentary: items.filter((i) => !i.comment && !i.resolved).length,
    });
  }
  // Most blocked first, newest week first within equal counts.
  groups.sort((a, b) => b.unresolved - a.unresolved || b.period.localeCompare(a.period));
  return groups;
}

/** Mark one flagged cell reviewed/unreviewed on the stored submission. */
export function setFlagResolved(
  period: string,
  entity: string,
  templateId: string,
  key: string,
  resolved: boolean,
): void {
  const stored = loadSubmission(period, entity, templateId);
  if (!stored) return;
  const set = new Set(stored.resolvedFlags ?? []);
  if (resolved) set.add(key);
  else set.delete(key);
  saveSubmission({ ...stored, resolvedFlags: [...set] });
}

/** Mark every flagged cell of a submission as reviewed. */
export function resolveAllFlags(period: string, entity: string, templateId: string): void {
  const stored = loadSubmission(period, entity, templateId);
  if (!stored) return;
  saveSubmission({ ...stored, resolvedFlags: [...(stored.flags ?? [])] });
}
