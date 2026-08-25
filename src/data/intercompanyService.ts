// ============================================================================
// Intercompany mirroring.
//
// An intercompany section is a section whose rows are LEGAL ENTITIES: the
// Netherlands does not forecast "€500k of intercompany payments", it forecasts
// €300k to France and €200k to Germany, and which is which is the whole point
// — it is what lets the group position net to zero. The rows are ordinary
// custom rows (see `customRows.ts`); what makes them intercompany is that they
// name an entity from the master data instead of being freely typed.
//
// The other half of the job is MIRRORING. When the Netherlands says it pays
// France, that row belongs in France's forecast too — with the sign flipped,
// marked as system-generated, and saying it came from the Netherlands. France
// reads it rather than edits it: both sides then hold the same figure by
// construction, which is what the group position depends on.
// ============================================================================
import type { CustomRow, ForecastTemplate, Submission } from '../types';
import {
  customCatIndex,
  customRowsOf,
  entityCode,
  isOwnRow,
  remapKeySet,
  remapRecord,
  remapRowKey,
  sectionKey,
  withRowValues,
} from './customRows';
import { listLegalEntities } from './legalEntityService';
import { periodsOf } from './periods';
import { loadSubmission, loadTemplates, saveSubmission } from '../storage/localStorage';
import { getOrCreateSubmission, isHandedOver, templateForEntity } from './submissionService';

/** Is this line settled between group companies rather than outside them? */
export function isIntercompanyCategory(
  template: Pick<ForecastTemplate, 'categories'>,
  catIdx: number,
): boolean {
  const cat = template.categories[catIdx];
  return cat?.intercompany === true && cat.subtotal !== true;
}

/** Cell keys of every intercompany line on a template's horizon. */
export function intercompanyCells(template: ForecastTemplate): Set<string> {
  const out = new Set<string>();
  const periods = periodsOf(template).count;
  template.categories.forEach((_cat, catIdx) => {
    if (!isIntercompanyCategory(template, catIdx)) return;
    for (let d = 0; d < periods; d++) out.add(`${catIdx}-${d}`);
  });
  return out;
}

/** The intercompany sections a template has, by their label. */
export function intercompanySections(template: Pick<ForecastTemplate, 'categories'>): string[] {
  const state = new Map<string, { label: string; ic: boolean }>();
  template.categories.forEach((cat, i) => {
    if (!cat.group || cat.subtotal) return;
    const key = sectionKey(cat.group);
    const seen = state.get(key);
    const ic = isIntercompanyCategory(template, i);
    state.set(key, { label: cat.group, ic: seen ? seen.ic && ic : ic });
  });
  return [...state.values()].filter((s) => s.ic).map((s) => s.label);
}

/**
 * Where a mirrored row lands on the counterparty's template.
 *
 * Matched by SECTION label, not by index: entities can be on different
 * templates, and "IC Settlements" must land on "IC Settlements" wherever it
 * happens to sit. A template with one intercompany section and a different
 * name for it still receives the row — anything else would silently drop a
 * figure the group position needs.
 */
function targetSection(template: ForecastTemplate, section: string): string | null {
  const sections = intercompanySections(template);
  const match = sections.find((s) => sectionKey(s) === sectionKey(section));
  return match ?? sections[0] ?? null;
}

/** What happened to one counterparty when this entity's rows were saved. */
export interface MirrorOutcome {
  counterparty: string;
  status: 'mirrored' | 'unknown-entity' | 'no-template' | 'no-section' | 'consolidated';
  /**
   * The mirror landed on a forecast that had already been handed over, so the
   * figures somebody signed off no longer match what is in there.
   */
  late?: boolean;
}

/** Human wording for an outcome that is not a clean mirror. */
export function mirrorProblem(outcome: MirrorOutcome): string | null {
  switch (outcome.status) {
    case 'mirrored':
      return outcome.late
        ? `${outcome.counterparty} has already submitted — the row is in their forecast and marked as arriving late.`
        : null;
    case 'unknown-entity':
      return `${outcome.counterparty} is not a configured legal entity, so nothing was mirrored.`;
    case 'no-template':
      return `${outcome.counterparty} has no forecast template assigned, so nothing was mirrored.`;
    case 'no-section':
      return `${outcome.counterparty}'s template has no intercompany section, so nothing was mirrored.`;
    case 'consolidated':
      return `${outcome.counterparty}'s forecast is already consolidated, so it stays as reported.`;
  }
}

/** Deterministic id for the mirror of one row, so edits find it again. */
const mirrorId = (source: string, rowId: string): string => `mirror:${source}:${rowId}`;

/** One row's figures across the horizon, negated for the other side. */
function flippedFigures(
  template: Pick<ForecastTemplate, 'categories'>,
  rows: CustomRow[],
  rowId: string,
  values: Record<string, number>,
  periods: number,
): Record<string, number> {
  const index = rows.findIndex((r) => r.id === rowId);
  if (index < 0) return {};
  const catIdx = customCatIndex(template, index);
  const out: Record<string, number> = {};
  for (let d = 0; d < periods; d++) {
    const v = values[`${catIdx}-${d}`];
    // The other side of the same movement: what one entity pays, the other
    // receives.
    if (v) out[String(d)] = -v;
  }
  return out;
}

/**
 * A fingerprint of everything this entity currently SAYS about its
 * counterparties — the rows and the figures on them.
 *
 * Mirroring is driven off this rather than off each edit: a figure typed into
 * a row, a row added, a counterparty repointed, an undo, a reset and a copied
 * prior week are all the same statement about what this entity will pay, and
 * the counterparties' forecasts have to follow all of them.
 */
export function mirrorFingerprint(
  template: Pick<ForecastTemplate, 'categories'>,
  rows: CustomRow[],
  values: Record<string, number>,
  periods: number,
): string {
  const parts: string[] = [];
  rows.forEach((row, i) => {
    if (!isOwnRow(row) || !row.entity) return;
    const catIdx = customCatIndex(template, i);
    const figures: string[] = [];
    for (let d = 0; d < periods; d++) {
      const v = values[`${catIdx}-${d}`];
      if (v) figures.push(`${d}:${v}`);
    }
    // An empty row is not part of the statement — see `syncMirrors`.
    if (figures.length === 0) return;
    parts.push(`${row.id}|${row.entity}|${sectionKey(row.section)}|${figures.join(',')}`);
  });
  return parts.sort().join(';');
}

export interface SyncMirrorsArgs {
  /** Forecast week the rows were entered for. */
  period: string;
  /** Entity whose submitter entered them. */
  entity: string;
  /** That entity's template — the rows are indexed against it. */
  template: ForecastTemplate;
  /** Every custom row on this forecast, this entity's own and mirrored alike. */
  rows: CustomRow[];
  /** The forecast's figures after the edit. */
  values: Record<string, number>;
}

/**
 * Push this entity's intercompany rows into the counterparties' forecasts,
 * and withdraw anything this forecast used to say and no longer does.
 *
 * Rebuilt rather than patched: every mirror this entity previously wrote is
 * stripped from every counterparty first, then the current rows are written.
 * That one rule covers editing a figure, repointing a row at a different
 * counterparty, deleting a row and clearing a forecast — all of which would
 * otherwise need a code path each, and any of which would leave a stale figure
 * standing in somebody else's forecast.
 *
 * Mirrored rows never mirror back: only rows this entity entered itself
 * travel, or two entities pointing at each other would bounce forever.
 */
export function syncMirrors(args: SyncMirrorsArgs): MirrorOutcome[] {
  const { period, entity, template, rows, values } = args;
  const templates = loadTemplates();
  const periods = periodsOf(template).count;
  const outcomes: MirrorOutcome[] = [];

  /** What each counterparty should now hold from this forecast. */
  const wanted = new Map<string, { row: CustomRow; figures: Record<string, number> }[]>();
  for (const row of rows) {
    if (!isOwnRow(row) || !row.entity) continue;
    const figures = flippedFigures(template, rows, row.id, values, periods);
    // A row with no figures on it says nothing yet. Naming a counterparty is
    // not a statement about money, and pushing an empty row into their
    // forecast — telling a country that has already submitted that its
    // figures have changed — is a notification about nothing.
    if (Object.keys(figures).length === 0) continue;
    const list = wanted.get(row.entity) ?? [];
    list.push({ row, figures });
    wanted.set(row.entity, list);
  }

  // Everyone who should hold a mirror, plus everyone who currently holds one
  // and may no longer be a counterparty at all.
  const candidates = new Set<string>(wanted.keys());
  for (const legal of listLegalEntities()) {
    if (legal.name === entity || legal.status !== 'active') continue;
    if (candidates.has(legal.name)) continue;
    const other = templateForEntity(templates, legal.name);
    if (!other) continue;
    const stored = loadSubmission(period, legal.name, other.id);
    if (customRowsOf(stored).some((r) => r.source === entity)) candidates.add(legal.name);
  }

  for (const counterparty of candidates) {
    const known = listLegalEntities().some((e) => e.name === counterparty && e.status === 'active');
    if (!known) {
      outcomes.push({ counterparty, status: 'unknown-entity' });
      continue;
    }
    const targetTemplate = templateForEntity(templates, counterparty);
    if (!targetTemplate) {
      outcomes.push({ counterparty, status: 'no-template' });
      continue;
    }
    const target = getOrCreateSubmission(counterparty, period, targetTemplate);
    // A consolidated forecast is history — the group position has been struck
    // on those figures and nothing may rewrite them behind it.
    if (target.status === 'consolidated') {
      outcomes.push({ counterparty, status: 'consolidated' });
      continue;
    }

    const before = customRowsOf(target);
    const kept = before.filter((r) => r.source !== entity);
    const incoming = wanted.get(counterparty) ?? [];
    // Each row lands in the counterparty's matching section, so an entity
    // forecasting into two intercompany sections mirrors into both.
    const sections = incoming.map(({ row }) => targetSection(targetTemplate, row.section));
    if (sections.some((s) => s === null)) {
      outcomes.push({ counterparty, status: 'no-section' });
      continue;
    }
    // The mirror rewrites figures somebody may already have signed off.
    const late = isHandedOver(target.status);
    const mirrored: CustomRow[] = incoming.map(({ row }, i) => ({
      id: mirrorId(entity, row.id),
      section: sections[i] as string,
      label: entityCode(entity),
      entity,
      source: entity,
      sourceRowId: row.id,
      ...(late ? { late: true as const } : {}),
    }));
    const after = [...kept, ...mirrored];
    if (before.length === 0 && after.length === 0) continue;

    // Rows moved up a place when the old mirrors came out, so the figures,
    // flags and commentary of everything below them move with them.
    const remap = remapRowKey(targetTemplate, before, kept);
    let nextValues = remapRecord(target.values, remap);
    const nextFlags = [...remapKeySet(target.flags, remap)];
    const nextComments = remapRecord(target.comments ?? {}, remap);
    const nextRequests = remapRecord(target.commentRequests ?? {}, remap);
    const targetPeriods = periodsOf(targetTemplate).count;
    mirrored.forEach((_mirror, i) => {
      const catIdx = customCatIndex(targetTemplate, kept.length + i);
      nextValues = withRowValues(
        nextValues,
        catIdx,
        targetPeriods,
        incoming[i].figures,
      );
    });

    const next: Submission = {
      ...target,
      values: nextValues,
      flags: nextFlags,
      comments: nextComments,
      commentRequests: nextRequests,
      ...(after.length > 0 ? { customRows: after } : { customRows: undefined }),
      updatedAt: new Date().toISOString(),
    };
    saveSubmission(next);
    outcomes.push({ counterparty, status: 'mirrored', ...(late && mirrored.length > 0 ? { late } : {}) });
  }

  return outcomes;
}
