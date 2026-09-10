// ============================================================================
// Intercompany settlements.
//
// An intercompany section is a section whose rows are LEGAL ENTITIES: the
// Netherlands does not forecast "€500k of intercompany payments", it forecasts
// €300k to France and €200k to Germany, and which is which is the whole point
// — it is what lets the group position net to zero. The rows are ordinary
// custom rows (see `customRows.ts`); what makes them intercompany is that they
// name an entity from the master data instead of being freely typed.
//
// The other half of the job is telling a submitter what the rest of the group
// has already said about them. When the Netherlands' approved forecast says it
// pays France on Thursday, France is going to write that same amount down as a
// receipt — and the surest way to get it right is to read what the Netherlands
// filed rather than to ask France to remember it.
//
// So the table beside the grid is a REFERENCE, not a feed. It lists what other
// entities' approved forecasts state about this one, and a button copies one
// into the grid on the days it falls. What lands there is an ordinary row of
// this forecast: the submitter can change the figure, add to it, or delete the
// row, exactly as if they had typed it. Nothing links the two afterwards — if
// the Netherlands reopens their forecast and changes their mind, this forecast
// does not move, because a figure that has been copied is this entity's own
// statement about its own cash.
//
// APPROVED FORECASTS ONLY, which is why copying is safe to do this way: a
// settlement is a claim on another country's cash, and a number somebody is
// still typing is not one to copy.
// ============================================================================
import type { CustomRow, ForecastTemplate, Submission } from '../types';
import {
  customCatIndex,
  customRowsOf,
  gridCategories,
  makeCustomRow,
  sectionKey,
} from './customRows';
import { listLegalEntities } from './legalEntityService';
import { periodsOf, prevWeekKey, rollShift } from './periods';
import { loadSubmission, loadTemplates } from '../storage/localStorage';
import { templateForEntity, toneOf } from './submissionService';

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
 * Where a copied row lands on this entity's template.
 *
 * Matched by SECTION label, not by index: entities can be on different
 * templates, and "IC Settlements" must land on "IC Settlements" wherever it
 * happens to sit. A template with one intercompany section and a different
 * name for it still takes the row — anything else would silently drop a
 * figure the group position needs.
 */
function targetSection(template: ForecastTemplate, section: string): string | null {
  const sections = intercompanySections(template);
  const match = sections.find((s) => sectionKey(s) === sectionKey(section));
  return match ?? sections[0] ?? null;
}

/**
 * Which of a forecast's lines are intercompany — the template's own, and the
 * rows added under them — as indexes in the shared cell-key space.
 *
 * The GRID's lines, not the template's. An intercompany amount rarely lives on
 * the template's IC line; it lives on the rows added underneath it, one per
 * counterparty, appended after the template's categories in the same key
 * space. Reading the template alone finds every intercompany line empty.
 */
export function intercompanyLines(
  sub: Pick<Submission, 'customRows'> | null | undefined,
  template: ForecastTemplate,
): Set<number> {
  const lines = gridCategories(template, customRowsOf(sub));
  const out = new Set<number>();
  lines.forEach((_cat, catIdx) => {
    if (isIntercompanyCategory({ categories: lines }, catIdx)) out.add(catIdx);
  });
  return out;
}

/**
 * Which side of an intercompany settlement an entity is booking.
 *
 * `payables` — it is paying a group company; `receivables` — it is being paid
 * by one. An entity can be both in the same cycle, which is the normal case
 * for a shared-service centre, so this is a SET rather than a mode.
 */
export type IntercompanyMethod = 'payables' | 'receivables';

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
export function intercompanyMethodsOf(
  sub: Pick<Submission, 'values' | 'customRows'> | null | undefined,
  template: ForecastTemplate,
): Set<IntercompanyMethod> {
  const out = new Set<IntercompanyMethod>();
  if (!sub) return out;
  const periods = periodsOf(template).count;
  for (const catIdx of intercompanyLines(sub, template)) {
    for (let d = 0; d < periods; d++) {
      const v = sub.values?.[`${catIdx}-${d}`];
      if (typeof v !== 'number' || v === 0) continue;
      out.add(v < 0 ? 'payables' : 'receivables');
    }
  }
  return out;
}

/** Is anything moving between this entity and the rest of the group? */
export function settlesIntercompany(
  sub: Pick<Submission, 'values' | 'customRows'> | null | undefined,
  template: ForecastTemplate,
): boolean {
  return intercompanyMethodsOf(sub, template).size > 0;
}

/**
 * A forecast's figures with its intercompany settlements left out, so a total
 * is what an entity expects to move with the world OUTSIDE the group.
 *
 * Both sides of a settlement are in the group's books — one country pays what
 * another receives — so a consolidated position that includes them is the
 * right answer to a different question. This is the other one.
 */
export function withoutIntercompany(
  sub: Pick<Submission, 'values' | 'customRows'>,
  template: ForecastTemplate,
): Record<string, number> {
  const drop = intercompanyLines(sub, template);
  if (drop.size === 0) return sub.values ?? {};
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(sub.values ?? {})) {
    if (!drop.has(Number(key.split('-')[0]))) out[key] = v;
  }
  return out;
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
 * What another entity STATES about this one, once somebody has signed it off:
 * its own intercompany rows that name us, with the figures already flipped to
 * our side.
 *
 * APPROVED FORECASTS ONLY. A settlement is a claim on another country's cash,
 * and one nobody has approved is a figure their submitter is still moving
 * around — copying it would put this week's guess into a forecast that will be
 * read as a commitment.
 */
function statementsFrom(
  source: string,
  period: string,
  target: string,
  templates: ForecastTemplate[],
): { row: CustomRow; figures: Record<string, number> }[] {
  const sourceTemplate = templateForEntity(templates, source);
  if (!sourceTemplate) return [];
  const stored = loadSubmission(period, source, sourceTemplate.id);
  if (!stored) return [];
  // `consolidated` is approved and then some — see `toneOf`.
  if (toneOf(stored.status) !== 'approved') return [];
  const rows = customRowsOf(stored);
  const periods = periodsOf(sourceTemplate).count;
  const out: { row: CustomRow; figures: Record<string, number> }[] = [];
  for (const row of rows) {
    if (row.entity !== target) continue;
    const figures = flippedFigures(sourceTemplate, rows, row.id, stored.values, periods);
    if (Object.keys(figures).length === 0) continue;
    out.push({ row, figures });
  }
  return out;
}

// ---------------------------------------------------------------------------
// WHAT THE REST OF THE GROUP HAS SAID ABOUT YOU
//
// A submitter filling in their intercompany section is writing down the same
// settlements their counterparties have already written down, from the other
// side. These read those, for this week and the two behind it, so the table
// beside the grid can show them — and so a button can copy one in rather than
// leaving somebody to retype a figure that is already in the system.
// ---------------------------------------------------------------------------

/** One counterparty's approved statement about this entity, across three weeks. */
export interface CounterpartyStatement {
  /** The counterparty making it. */
  counterparty: string;
  /** Their row's id — this statement's identity in the list. */
  rowId: string;
  /** The section they booked it in, so a copy lands in the matching one. */
  section: string;
  /** Day indexes on THIS entity's horizon that the statement touches. */
  days: number[];
  /** Day index (as a string) to amount, already on our side of the settlement. */
  figures: Record<string, number>;
  /** What they state for this week, on our side. */
  current: number;
  /** The same statement one and two cycles back; null where they made none. */
  prior1: number | null;
  prior2: number | null;
}

/** The amounts a counterparty states about `target` in one week, by row and day. */
function figuresFrom(
  source: string,
  period: string,
  target: string,
  templates: ForecastTemplate[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { row, figures } of statementsFrom(source, period, target, templates)) {
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
export function counterpartyStatements(
  entity: string,
  period: string,
  template: ForecastTemplate,
): CounterpartyStatement[] {
  const templates = loadTemplates();
  const step = rollShift(template);
  const priorPeriods = [prevWeekKey(period), prevWeekKey(prevWeekKey(period))];

  /**
   * The same row N cycles back, read at the days that line up with these.
   * Horizons roll a cycle at a time, so our day d was their day d + N·roll.
   */
  const priorTotal = (
    source: string,
    rowId: string,
    days: number[],
    back: number,
  ): number | null => {
    const past = figuresFrom(source, priorPeriods[back - 1], entity, templates);
    let sum = 0;
    let any = false;
    for (const d of days) {
      const v = past[`${rowId}:${d + back * step}`];
      if (typeof v === 'number') {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  };

  const out: CounterpartyStatement[] = [];
  for (const legal of listLegalEntities()) {
    if (legal.name === entity || legal.status !== 'active') continue;
    for (const { row, figures } of statementsFrom(legal.name, period, entity, templates)) {
      const days = Object.keys(figures)
        .map(Number)
        .filter((d) => Number.isFinite(d))
        .sort((a, b) => a - b);
      if (days.length === 0) continue;
      out.push({
        counterparty: legal.name,
        rowId: row.id,
        section: row.section,
        days,
        figures,
        current: days.reduce((s, d) => s + (figures[String(d)] ?? 0), 0),
        prior1: priorTotal(legal.name, row.id, days, 1),
        prior2: priorTotal(legal.name, row.id, days, 2),
      });
    }
  }
  // The biggest settlement first — it is the one worth checking.
  out.sort(
    (a, b) =>
      Math.abs(b.current) - Math.abs(a.current) || a.counterparty.localeCompare(b.counterparty),
  );
  return out;
}

/** A forecast's rows and figures after a statement has been copied into it. */
export interface CopyResult {
  rows: CustomRow[];
  values: Record<string, number>;
  /** Whether the copy needed a new row, as opposed to filling one in. */
  added: boolean;
}

/**
 * This forecast after a counterparty's statement is copied into it.
 *
 * The figures land on this entity's OWN row for that counterparty — the one it
 * already has, or a new one under the intercompany section — and only on the
 * days the statement touches, so a settlement of this entity's own sitting on
 * another day of the same row is left alone.
 *
 * What lands is an ordinary row. Nothing marks it as copied, because after
 * this it is not: it is this entity's figure, to change or delete like any
 * other, and it does not move again when the counterparty's forecast does.
 *
 * Returns the new state rather than writing it: the screen holds these in
 * React state and persists them itself, and a service that wrote behind it
 * would leave the grid showing the figures from before.
 */
export function copyStatement(args: {
  template: ForecastTemplate;
  rows: CustomRow[];
  values: Record<string, number>;
  statement: CounterpartyStatement;
}): CopyResult {
  const { template, rows, values, statement } = args;
  const section = targetSection(template, statement.section);
  if (!section) return { rows, values, added: false };

  let next = rows;
  let index = rows.findIndex(
    (r) => r.entity === statement.counterparty && sectionKey(r.section) === sectionKey(section),
  );
  const added = index < 0;
  if (added) {
    // Under the LINE the sign belongs to — money out beneath the outflow
    // line, money in beneath the inflow one — so a copied row sits where the
    // submitter would have typed it rather than loose at the foot of the
    // section. A section with one line for both keeps them together.
    const parent = template.categories.find(
      (c) =>
        c.group === section &&
        c.intercompany === true &&
        !c.subtotal &&
        /out/i.test(c.label) === statement.current < 0,
    )?.label;
    next = [...rows, makeCustomRow(section, parent, '', statement.counterparty)];
    index = next.length - 1;
  }

  const catIdx = customCatIndex(template, index);
  const out = { ...values };
  for (const [day, v] of Object.entries(statement.figures)) {
    const key = `${catIdx}-${Number(day)}`;
    if (v) out[key] = v;
    else delete out[key];
  }
  return { rows: next, values: out, added };
}
