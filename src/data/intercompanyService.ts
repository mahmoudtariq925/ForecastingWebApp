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
import type { CommentRequest, CustomRow, ForecastTemplate, Submission } from '../types';
import {
  customCatIndex,
  customRowsOf,
  entityCode,
  gridCategories,
  isOwnRow,
  remapKeySet,
  remapRecord,
  remapRowKey,
  sectionKey,
  withRowValues,
} from './customRows';
import { listLegalEntities } from './legalEntityService';
import { periodsOf, prevWeekKey, rollShift } from './periods';
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

/**
 * What a forecast ACCEPTS from the other side of the group.
 *
 * Mirroring is a statement somebody else makes about your figures, and the
 * entity holding them has a say in whether it carries them yet: a country
 * closing its books does not want a counterparty's late row landing in the
 * middle of it, and a shared-service centre settling with nine others may
 * want two of them in and the rest left out while it reconciles.
 *
 * `sources` empty means EVERY counterparty, the same way a filter with
 * nothing selected is unfiltered rather than empty — see `MultiSelect`.
 */
export interface MirrorPrefs {
  /** Whether mirrored rows are carried into this forecast at all. */
  enabled: boolean;
  /** The counterparties whose rows are taken; empty means all of them. */
  sources: string[];
}

export const DEFAULT_MIRROR_PREFS: MirrorPrefs = { enabled: true, sources: [] };

/** What a stored forecast accepts, defaulting to everything. */
export function mirrorPrefsOf(
  sub: Pick<Submission, 'mirrorPrefs'> | null | undefined,
): MirrorPrefs {
  const stored = sub?.mirrorPrefs;
  if (!stored) return DEFAULT_MIRROR_PREFS;
  return {
    enabled: stored.enabled !== false,
    sources: Array.isArray(stored.sources) ? stored.sources : [],
  };
}

/** Does this forecast carry rows mirrored from `source`? */
export function acceptsMirrorFrom(prefs: MirrorPrefs, source: string | undefined): boolean {
  if (!prefs.enabled || !source) return false;
  return prefs.sources.length === 0 || prefs.sources.includes(source);
}

/** Whether the prefs are anything other than "take everything". */
export function mirrorPrefsFiltered(prefs: MirrorPrefs): boolean {
  return !prefs.enabled || prefs.sources.length > 0;
}

/**
 * Which side of an intercompany settlement an entity is booking.
 *
 * `payables` — it is paying a group company; `receivables` — it is being paid
 * by one. An entity can be both in the same cycle, which is the normal case
 * for a shared-service centre, so this is a SET rather than a mode.
 */
export type MirrorMethod = 'payables' | 'receivables';

/**
 * How an entity settles intercompany this cycle, read off its own IC lines
 * rather than off a setting somebody has to remember to keep current.
 *
 * The sign is the classification: the app's whole convention is inflows
 * positive, outflows negative (see the template notes), so an amount on an
 * intercompany line already says which side of the settlement it is. Reading
 * it this way also means any template works — a workbook that calls its lines
 * "IC Receipts" and "IC Payments", or holds both on one line, classifies
 * correctly without being taught the names.
 */
export function mirrorMethodsOf(
  sub: Pick<Submission, 'values' | 'customRows'> | null | undefined,
  template: ForecastTemplate,
): Set<MirrorMethod> {
  const out = new Set<MirrorMethod>();
  if (!sub) return out;
  const periods = periodsOf(template).count;
  /**
   * The GRID's lines, not the template's.
   *
   * An intercompany amount does not live on the template's own IC line — that
   * cell holds the sum of its rows and nothing else. It lives on the rows
   * added underneath it, one per counterparty, which are appended after the
   * template's categories in the same cell-key space. Reading the template
   * alone finds every intercompany line empty and classifies the whole group
   * as settling nothing.
   */
  const lines = gridCategories(template, customRowsOf(sub));
  lines.forEach((_cat, catIdx) => {
    if (!isIntercompanyCategory({ categories: lines }, catIdx)) return;
    for (let d = 0; d < periods; d++) {
      const v = sub.values?.[`${catIdx}-${d}`];
      if (typeof v !== 'number' || v === 0) continue;
      out.add(v < 0 ? 'payables' : 'receivables');
    }
  });
  return out;
}

/**
 * Does this forecast take part in mirroring at all — is it on, and is there
 * anything on its intercompany lines for it to carry?
 *
 * Mirroring switched off and mirroring switched on over an empty section come
 * to the same thing on a dashboard: nothing is moving between this entity and
 * the rest of the group.
 */
export function mirrorsIntercompany(
  sub: Pick<Submission, 'values' | 'customRows' | 'mirrorPrefs'> | null | undefined,
  template: ForecastTemplate,
): boolean {
  if (!sub || !mirrorPrefsOf(sub).enabled) return false;
  return mirrorMethodsOf(sub, template).size > 0;
}

/** What happened to one counterparty when this entity's rows were saved. */
export interface MirrorOutcome {
  counterparty: string;
  status:
    | 'mirrored'
    | 'unknown-entity'
    | 'no-template'
    | 'no-section'
    | 'consolidated'
    | 'declined';
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
    // Said plainly, because the alternative is a submitter watching a figure
    // they entered simply not appear on the other side.
    case 'declined':
      return `${outcome.counterparty} is not taking mirrored rows from you at the moment, so the row stayed in your forecast only.`;
  }
}

/** Deterministic id for the mirror of one row, so edits find it again. */
const mirrorId = (source: string, rowId: string): string => `mirror:${source}:${rowId}`;

/** The row one entity's statement becomes in the counterparty's forecast. */
function mirrorRowFor(source: string, row: CustomRow, section: string, late: boolean): CustomRow {
  return {
    id: mirrorId(source, row.id),
    section,
    label: entityCode(source),
    entity: source,
    source,
    sourceRowId: row.id,
    ...(late ? { late: true as const } : {}),
  };
}

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
    // The counterparty decides what it carries. Declining does not merely
    // stop new rows: anything this entity wrote there before comes out, so
    // "not taking rows from the Netherlands" means exactly that.
    const accepted = acceptsMirrorFrom(mirrorPrefsOf(target), entity);
    const incoming = accepted ? (wanted.get(counterparty) ?? []) : [];
    if (!accepted && (wanted.get(counterparty)?.length ?? 0) > 0) {
      outcomes.push({ counterparty, status: 'declined' });
    }
    // Each row lands in the counterparty's matching section, so an entity
    // forecasting into two intercompany sections mirrors into both.
    const sections = incoming.map(({ row }) => targetSection(targetTemplate, row.section));
    if (sections.some((s) => s === null)) {
      outcomes.push({ counterparty, status: 'no-section' });
      continue;
    }
    // The mirror rewrites figures somebody may already have signed off.
    const late = isHandedOver(target.status);
    const mirrored: CustomRow[] = incoming.map(({ row }, i) =>
      mirrorRowFor(entity, row, sections[i] as string, late),
    );
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
    if (accepted) {
      outcomes.push({
        counterparty,
        status: 'mirrored',
        ...(late && mirrored.length > 0 ? { late } : {}),
      });
    }
  }

  return outcomes;
}

/**
 * What another entity currently STATES about this one: its own intercompany
 * rows that name us, with the figures already flipped to our side.
 *
 * Read from what they have stored rather than from what they are typing —
 * this runs on our screen, not theirs.
 */
function statedMirrors(
  source: string,
  period: string,
  target: string,
  templates: ForecastTemplate[],
): { row: CustomRow; figures: Record<string, number> }[] {
  const sourceTemplate = templateForEntity(templates, source);
  if (!sourceTemplate) return [];
  const stored = loadSubmission(period, source, sourceTemplate.id);
  if (!stored) return [];
  const rows = customRowsOf(stored);
  const periods = periodsOf(sourceTemplate).count;
  const out: { row: CustomRow; figures: Record<string, number> }[] = [];
  for (const row of rows) {
    if (!isOwnRow(row) || row.entity !== target) continue;
    const figures = flippedFigures(sourceTemplate, rows, row.id, stored.values, periods);
    if (Object.keys(figures).length === 0) continue;
    out.push({ row, figures });
  }
  return out;
}

/** This forecast's state after its mirrored rows are brought into line. */
export interface MirrorRebuild {
  rows: CustomRow[];
  values: Record<string, number>;
  flags: string[];
  comments: Record<string, string>;
  commentRequests: Record<string, CommentRequest>;
  /** Counterparties whose rows were pulled in by the change. */
  added: string[];
  /** Counterparties whose rows were dropped by it. */
  dropped: string[];
}

/**
 * Bring a forecast's mirrored rows in line with what it now accepts.
 *
 * Mirroring is otherwise pushed: a counterparty types, and their row appears
 * here. That is no use to somebody changing what they accept — turning a
 * counterparty back on would show nothing until that counterparty happened to
 * type again — so this reads the other side directly and settles both
 * directions at once: rows from a declined counterparty come out, rows from
 * an accepted one that are not here yet go in.
 *
 * Returns the new state rather than writing it: the screen holds these in
 * React state and persists them itself, and a service that wrote behind it
 * would leave the grid showing the figures from before.
 */
export function rebuildMirrors(args: {
  period: string;
  entity: string;
  template: ForecastTemplate;
  prefs: MirrorPrefs;
  rows: CustomRow[];
  values: Record<string, number>;
  flags: string[];
  comments: Record<string, string>;
  commentRequests: Record<string, CommentRequest>;
}): MirrorRebuild {
  const { period, entity, template, prefs, rows: before } = args;
  const templates = loadTemplates();
  const periods = periodsOf(template).count;

  const kept = before.filter((r) => isOwnRow(r) || acceptsMirrorFrom(prefs, r.source));
  const dropped = [
    ...new Set(
      before.filter((r) => !isOwnRow(r) && !acceptsMirrorFrom(prefs, r.source)).map((r) => r.source as string),
    ),
  ];

  // Everything accepted that is not already here.
  const held = new Set(kept.filter((r) => !isOwnRow(r)).map((r) => r.id));
  const incoming: { row: CustomRow; figures: Record<string, number> }[] = [];
  const added: string[] = [];
  if (prefs.enabled) {
    for (const legal of listLegalEntities()) {
      if (legal.name === entity || legal.status !== 'active') continue;
      if (!acceptsMirrorFrom(prefs, legal.name)) continue;
      for (const stated of statedMirrors(legal.name, period, entity, templates)) {
        if (held.has(mirrorId(legal.name, stated.row.id))) continue;
        const section = targetSection(template, stated.row.section);
        if (!section) continue;
        incoming.push({
          row: mirrorRowFor(legal.name, stated.row, section, false),
          figures: stated.figures,
        });
        if (!added.includes(legal.name)) added.push(legal.name);
      }
    }
  }

  // Rows moved up a place when the declined ones came out, so the figures,
  // flags and commentary of everything below them move with them.
  const remap = remapRowKey(template, before, kept);
  let values = remapRecord(args.values, remap);
  const flags = [...remapKeySet(args.flags, remap)];
  const comments = remapRecord(args.comments, remap);
  const commentRequests = remapRecord(args.commentRequests, remap);
  incoming.forEach((inc, i) => {
    values = withRowValues(values, customCatIndex(template, kept.length + i), periods, inc.figures);
  });

  return {
    rows: [...kept, ...incoming.map((inc) => inc.row)],
    values,
    flags,
    comments,
    commentRequests,
    added,
    dropped,
  };
}

// ---------------------------------------------------------------------------
// WHAT THE REST OF THE GROUP SAYS ABOUT YOU
//
// Mirroring is pushed: a counterparty types, and their figure lands here. That
// is fine for carrying a settlement but useless for reading one — a submitter
// could see what had arrived and nothing about what was on offer, so a
// counterparty's statement that this forecast had declined was invisible, and
// the same statement a week ago was invisible whatever the setting.
//
// These read the other side directly, for this week and the two behind it, and
// return every statement whether or not it is currently carried. The table
// beside the outlook is a view of exactly this.
// ---------------------------------------------------------------------------

/** One counterparty's statement about this entity, across three weeks. */
export interface MirrorStatement {
  /** The counterparty making it. */
  counterparty: string;
  /** Their row's id — stable, and what the figures are keyed to. */
  rowId: string;
  /** Day indexes on THIS entity's horizon that the statement touches. */
  days: number[];
  /** What they state for this week, on our side of the settlement. */
  current: number;
  /** The same statement one and two cycles back; null where they made none. */
  prior1: number | null;
  prior2: number | null;
  /** Is this forecast carrying it right now? */
  carried: boolean;
}

/** The total a counterparty states about `target` in one week, by day. */
function statedFigures(
  source: string,
  period: string,
  target: string,
  templates: ForecastTemplate[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { row, figures } of statedMirrors(source, period, target, templates)) {
    for (const [day, v] of Object.entries(figures)) {
      out[`${row.id}:${day}`] = v;
    }
  }
  return out;
}

/**
 * Every statement the rest of the group makes about this entity's week, with
 * the same statement one and two cycles back beside it.
 *
 * Horizons roll forward a cycle at a time, so a forecast N cycles back covers
 * this week's day d at its own day `d + N·roll` — the same alignment the
 * chart's overlays use. Past the end of that horizon there is no statement to
 * compare against, which is a gap rather than a zero.
 */
export function mirrorStatements(
  entity: string,
  period: string,
  template: ForecastTemplate,
): MirrorStatement[] {
  const templates = loadTemplates();
  const stored = loadSubmission(period, entity, template.id);
  const carried = new Set(
    customRowsOf(stored)
      .filter((r) => !isOwnRow(r) && r.sourceRowId)
      .map((r) => `${r.source}:${r.sourceRowId}`),
  );
  const step = rollShift(template);
  const priorPeriods = [prevWeekKey(period), prevWeekKey(prevWeekKey(period))];

  const out: MirrorStatement[] = [];
  for (const legal of listLegalEntities()) {
    if (legal.name === entity || legal.status !== 'active') continue;
    for (const { row, figures } of statedMirrors(legal.name, period, entity, templates)) {
      const days = Object.keys(figures)
        .map(Number)
        .filter((d) => Number.isFinite(d))
        .sort((a, b) => a - b);
      if (days.length === 0) continue;
      const current = days.reduce((s, d) => s + (figures[String(d)] ?? 0), 0);

      // The same row, N cycles back, read at the day that lines up with ours.
      const priorTotal = (back: number): number | null => {
        const past = statedFigures(legal.name, priorPeriods[back - 1], entity, templates);
        let sum = 0;
        let seen = false;
        for (const d of days) {
          const v = past[`${row.id}:${d + back * step}`];
          if (typeof v === 'number') {
            sum += v;
            seen = true;
          }
        }
        return seen ? sum : null;
      };

      out.push({
        counterparty: legal.name,
        rowId: row.id,
        days,
        current,
        prior1: priorTotal(1),
        prior2: priorTotal(2),
        carried: carried.has(`${legal.name}:${row.id}`),
      });
    }
  }
  // The biggest settlement first — it is the one worth a decision.
  out.sort(
    (a, b) =>
      Math.abs(b.current) - Math.abs(a.current) ||
      a.counterparty.localeCompare(b.counterparty),
  );
  return out;
}

/**
 * The prefs that carry (or stop carrying) one counterparty, given everything
 * currently on offer.
 *
 * `sources: []` means EVERY counterparty, so declining one has to materialise
 * the list first; accepting the last missing one collapses it back to empty,
 * or the forecast would silently stop accepting a counterparty added later.
 */
export function mirrorPrefsToggling(
  prefs: MirrorPrefs,
  counterparty: string,
  allSources: string[],
): MirrorPrefs {
  const accepted = new Set(
    prefs.enabled ? (prefs.sources.length === 0 ? allSources : prefs.sources) : [],
  );
  if (accepted.has(counterparty)) accepted.delete(counterparty);
  else accepted.add(counterparty);
  const kept = allSources.filter((s) => accepted.has(s));
  if (kept.length === 0) return { enabled: false, sources: [] };
  return { enabled: true, sources: kept.length === allSources.length ? [] : kept };
}

/**
 * A forecast's figures with everything mirrored in from other entities taken
 * out — only what this entity's own submitter entered.
 *
 * A mirrored row is somebody else's statement about you: real money, and part
 * of the group position, but not part of what YOU forecast. Reading the group
 * both ways is the point — with the mirrors in, it is what the group expects
 * to move; with them out, it is what the countries themselves have said,
 * which is the number to check a submitter's work against.
 *
 * Only the figures are stripped, not the rows: callers aggregate by cell key,
 * and a row with no cells left contributes nothing anyway.
 */
export function ownFiguresOnly(
  sub: Pick<Submission, 'values' | 'customRows'>,
  template: ForecastTemplate,
): Record<string, number> {
  const rows = customRowsOf(sub);
  const mirrored = new Set<number>();
  rows.forEach((row, i) => {
    if (!isOwnRow(row)) mirrored.add(customCatIndex(template, i));
  });
  if (mirrored.size === 0) return sub.values ?? {};
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(sub.values ?? {})) {
    if (!mirrored.has(Number(key.split('-')[0]))) out[key] = v;
  }
  return out;
}
