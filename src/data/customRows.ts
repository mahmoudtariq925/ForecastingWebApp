// ============================================================================
// Custom rows: the lines a submitter adds under a section of their forecast.
//
// A template says what a forecast is SHAPED like. It cannot say what one
// country's receivables are made of — that is "Customer A, Customer B, other",
// and it differs by entity and by week. So every section header carries a `+`,
// and the rows added under it belong to the submission rather than to the
// template.
//
// The whole design rests on one decision: a custom row is a ROW OF THE GRID,
// not a side table. Row `i` of `submission.customRows` addresses its figures
// as `${template.categories.length + i}-${dayIdx}` in `submission.values`, so
// the grid, the section totals, the variance flags, the commentary, undo and
// the Excel export all treat it exactly as they treat a template line, and
// none of them needed a special case to do it.
//
// What a custom row never becomes is a CATEGORY. Consolidation reads the
// template's sections, so "Customer A" is summed into Receivables and the
// name stays inside the forecast it was typed into (see `consolidatedValues`).
// ============================================================================
import type { CustomRow, ForecastTemplate, Submission, TemplateCategory } from '../types';
import { categoryGroups } from '../components/submissions/gridMath';
import { countryCode } from './countryCodes';
import { listLegalEntities } from './legalEntityService';

/**
 * A line as the GRID sees it: a template category, or one of the submitter's
 * own rows wearing the same shape. Everything that reads a forecast row —
 * `gridMath`, the grid itself — takes `TemplateCategory`, so a custom row is
 * simply one with provenance attached.
 */
export interface GridCategory extends TemplateCategory {
  /** Set when this line is a row the submitter added. */
  customRowId?: string;
  /**
   * What the submitter has typed into the row's name so far, as opposed to
   * `label`, which is what the row is CALLED — a placeholder while the name
   * is still blank, and the ISO code once the row names an entity.
   */
  customLabel?: string;
  /** Intercompany rows: the counterparty legal entity, by name. */
  entityName?: string;
  /** Mirrored from another entity's forecast, so read-only here. */
  source?: string;
  /** The mirror arrived after this forecast had been handed over. */
  late?: boolean;
}

/** Section identity: sections are named, and the name is the key. */
export const sectionKey = (label: string): string => label.trim().toLowerCase();

/** A submission's own rows — always an array, never undefined. */
export function customRowsOf(submission: Pick<Submission, 'customRows'> | null | undefined): CustomRow[] {
  return submission?.customRows ?? [];
}

/** Where row `index` addresses its figures, in the shared cell-key space. */
export const customCatIndex = (template: Pick<ForecastTemplate, 'categories'>, index: number): number =>
  template.categories.length + index;

/**
 * Every line the grid shows: the template's, then the submitter's own, each
 * carrying the section it was added under so it bands with its siblings.
 *
 * Custom rows are APPENDED rather than spliced in, which is what keeps the
 * cell keys of the template's own lines stable when a row is added or
 * removed. Where they RENDER is decided by their section — see
 * `categoryGroups`, which gathers a section's lines wherever they sit.
 */
export function gridCategories(
  template: Pick<ForecastTemplate, 'categories'>,
  rows: CustomRow[],
): GridCategory[] {
  const sectionIC = new Map<string, boolean>();
  for (const cat of template.categories) {
    if (!cat.group) continue;
    const key = sectionKey(cat.group);
    if (cat.subtotal) continue;
    sectionIC.set(key, (sectionIC.get(key) ?? true) && cat.intercompany === true);
  }
  return [
    ...template.categories,
    ...rows.map((row) => ({
      label: rowLabel(row),
      group: row.section,
      ...(sectionIC.get(sectionKey(row.section)) ? { intercompany: true as const } : {}),
      customRowId: row.id,
      customLabel: row.label,
      ...(row.entity ? { entityName: row.entity } : {}),
      ...(row.source ? { source: row.source } : {}),
      ...(row.late ? { late: true as const } : {}),
    })),
  ];
}

/**
 * How many lines a forecast has, template and custom together — the count
 * every per-day total is summed over. Reading `template.categories.length`
 * instead would leave the submitter's own rows out of the day's net.
 */
export const gridCatCount = (
  template: Pick<ForecastTemplate, 'categories'>,
  submission: Pick<Submission, 'customRows'> | null | undefined,
): number => template.categories.length + customRowsOf(submission).length;

/** A row's name: what the submitter typed, or the counterparty's ISO code. */
export function rowLabel(row: CustomRow): string {
  if (row.entity) return entityCode(row.entity);
  return row.label.trim() || 'Untitled row';
}

/**
 * How a legal entity is written on a forecast row: its ISO code.
 *
 * Rows sit inside a section that is already labelled, in a column set that is
 * already narrow — "Netherlands" would set the width of the row-label column
 * for the sake of a word the code says just as well. The full name stays in
 * the title attribute and in the dropdown.
 */
export function entityCode(name: string): string {
  const legal = listLegalEntities().find((e) => e.name === name);
  return countryCode(legal?.country?.trim() || name);
}

/** A legal entity a row can be about, as the dropdown wants it. */
export interface EntityOption {
  /** Master-data name — what is stored on the row. */
  name: string;
  /** ISO code — what is shown on the row. */
  code: string;
  /** Country, for the dropdown's second line. */
  country: string;
}

/**
 * The entities an intercompany row may name, for one entity's own forecast.
 *
 * Read from the configured legal entities and never typed: a counterparty
 * that does not resolve to a forecast is an amount that can never be mirrored
 * anywhere, so free text is not an option the UI offers.
 */
export function entityOptions(entity: string): EntityOption[] {
  return listLegalEntities()
    .filter((e) => e.status === 'active' && e.name !== entity)
    .map((e) => ({ name: e.name, code: countryCode(e.country?.trim() || e.name), country: e.country }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

let seq = 0;
/** Ids only have to be unique within one forecast; mirrors derive theirs. */
export function newRowId(): string {
  seq += 1;
  return `cr${seq}-${Date.now().toString(36)}`;
}

/** A fresh row under `section`, named (or not) by whoever added it. */
export function makeCustomRow(section: string, label = '', entity?: string): CustomRow {
  return { id: newRowId(), section, label, ...(entity ? { entity } : {}) };
}

/** A row this entity entered itself, as opposed to one mirrored into it. */
export const isOwnRow = (row: CustomRow): boolean => !row.source;

/**
 * Whether a section's rows are legal entities rather than free text: true
 * when every input line the template puts in it is intercompany.
 *
 * Derived rather than stored, so a template can never say a section is
 * intercompany while a line inside it disagrees.
 */
export function sectionIsIntercompany(categories: GridCategory[], idxs: number[]): boolean {
  const items = idxs.filter((i) => {
    const cat = categories[i];
    return cat && !cat.subtotal && cat.customRowId === undefined;
  });
  return items.length > 0 && items.every((i) => categories[i].intercompany === true);
}

// ---------------------------------------------------------------------------
// Editing the row list
//
// Adding a row is an append, so every existing cell key keeps its meaning.
// REMOVING one is not: every row after it moves up a place, and its figures,
// flags and commentary have to move with it. One remapper does that for all
// of them, so a deleted row can never leave a stray number one row below.
// ---------------------------------------------------------------------------

/**
 * Move every cell key from the row order `before` to the row order `after`,
 * dropping the keys of rows that are gone.
 *
 * Returns `null` for a key that no longer exists, and the key unchanged for
 * anything addressing a template line.
 */
export function remapRowKey(
  template: Pick<ForecastTemplate, 'categories'>,
  before: CustomRow[],
  after: CustomRow[],
): (key: string) => string | null {
  const base = template.categories.length;
  const target = new Map<string, number>();
  after.forEach((row, i) => target.set(row.id, base + i));
  const moved = new Map<number, number | null>();
  before.forEach((row, i) => moved.set(base + i, target.get(row.id) ?? null));

  return (key: string) => {
    const dash = key.indexOf('-');
    const catIdx = Number(key.slice(0, dash));
    if (!Number.isFinite(catIdx) || catIdx < base) return key;
    const next = moved.get(catIdx);
    if (next === undefined || next === null) return null;
    return `${next}${key.slice(dash)}`;
  };
}

/** Apply a key remap to one `${catIdx}-${dayIdx}` record. */
export function remapRecord<T>(
  record: Record<string, T>,
  remap: (key: string) => string | null,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const next = remap(key);
    if (next !== null) out[next] = value;
  }
  return out;
}

/** …and to a set of flagged cells. */
export function remapKeySet(keys: Iterable<string>, remap: (key: string) => string | null): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const next = remap(key);
    if (next !== null) out.add(next);
  }
  return out;
}

/** The figures of one custom row, by period index. */
export function rowValues(
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
    if (v !== undefined) out[String(d)] = v;
  }
  return out;
}

/** Write a row's figures into the flat cell map (clearing what it had). */
export function withRowValues(
  values: Record<string, number>,
  catIdx: number,
  periods: number,
  figures: Record<string, number>,
): Record<string, number> {
  const next = { ...values };
  for (let d = 0; d < periods; d++) {
    const key = `${catIdx}-${d}`;
    const v = figures[String(d)];
    if (v === undefined || v === 0) delete next[key];
    else next[key] = v;
  }
  return next;
}

/** Rows stored by an older version, made safe to read. */
export function normalizeCustomRows(raw: unknown): CustomRow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .filter((r): r is CustomRow => typeof r === 'object' && r !== null)
    .filter((r) => typeof r.id === 'string' && typeof r.section === 'string')
    .map((r) => ({
      id: r.id,
      section: r.section,
      label: typeof r.label === 'string' ? r.label : '',
      ...(typeof r.entity === 'string' ? { entity: r.entity } : {}),
      ...(typeof r.source === 'string' ? { source: r.source } : {}),
      ...(typeof r.sourceRowId === 'string' ? { sourceRowId: r.sourceRowId } : {}),
      ...(r.late === true ? { late: true as const } : {}),
    }));
  return rows.length > 0 ? rows : undefined;
}

/**
 * The grid's lines in READING order — every section's lines together — with
 * the figures re-keyed to match.
 *
 * On screen a section gathers its lines wherever they sit in the array, so
 * appending the submitter's rows costs nothing. Anything that walks the array
 * ITSELF — the Excel export, which merges a band across a section's columns —
 * needs them contiguous, and this is where that happens: one flattening,
 * rather than every consumer learning about custom rows.
 */
export function readingOrder(
  categories: GridCategory[],
  values: Record<string, number>,
  periods: number,
): { categories: GridCategory[]; values: Record<string, number> } {
  const order = categoryGroups(categories).flatMap((g) => g.idxs);
  const out: GridCategory[] = [];
  const nextValues: Record<string, number> = {};
  order.forEach((from, to) => {
    out.push(categories[from]);
    for (let d = 0; d < periods; d++) {
      const v = values[`${from}-${d}`];
      if (v !== undefined) nextValues[`${to}-${d}`] = v;
    }
  });
  return { categories: out, values: nextValues };
}

/**
 * Where a row's figures sat in ANOTHER week's forecast, or null when that
 * week had no such row.
 *
 * This is what keeps a brand-new row from reading as a variance. A row that
 * did not exist last week has no prior figure — not a prior figure of zero —
 * and treating the difference as a swing would flag every row on the day it
 * was added, which is the day there is least to explain about it.
 *
 * Matched by id first (a row copied from the prior week keeps its origin in
 * its id), then by what the row IS: the entity it names, or its name.
 */
export function priorRowIndex(
  row: CustomRow,
  priorRows: CustomRow[],
): number | null {
  const origin = row.id.replace(/:copy$/, '');
  const byId = priorRows.findIndex((r) => r.id === origin);
  if (byId >= 0) return byId;
  if (row.entity) {
    const byEntity = priorRows.findIndex((r) => r.entity === row.entity);
    return byEntity >= 0 ? byEntity : null;
  }
  const name = row.label.trim().toLowerCase();
  if (!name) return null;
  const byName = priorRows.findIndex((r) => r.label.trim().toLowerCase() === name);
  return byName >= 0 ? byName : null;
}
